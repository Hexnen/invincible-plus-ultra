/* Step "concept" (phase 5a): archetype (optional, the book's 16 from the creation tables), role (8), identity (secret / public, optional).
   - Archetype list: provider.list("archetypes") (the tables pack); each archetype's book data (role, suggested powers, attributes) comes from
     catalog.getArchetype and is read at runtime only, nothing is stored in the module.
   - Choosing an archetype only SELECTS it (and pre-selects its role unless the user picked another one by hand). The explicit button
     "Apply archetype defaults" then fills role + powers + power source + attributes through random.rollStep (withinArchetype, no variance:
     the book's own trade, adapted to the rank) and asks first when that would overwrite powers / attributes the user already set.
     Talents and drawbacks keep their own steps (their shortlists come with the archetype there).
   - Dice: "Roll archetype" = random.rollStep("concept", withinArchetype) on the seeded substream (rerolls.concept); "Roll role" uses the
     substream "conceptRole:<n>" (rerolls.conceptRole). Same seed + same counters = same rolls; undo restores the counters.
   - Radio groups are native radios (arrow keys move + select). Everything is one undo step per action. */
import { t } from "../lang.mjs";
import { confirmDialog } from "../dialogs.mjs";
import { ATTRS, ROLES, validateStep } from "../rules.mjs";
import { rollStep } from "../random.mjs";
import { substream } from "../rng.mjs";
import { rebase } from "../state.mjs";
import { esc, icon, msgText, delegate, attrShort, levelName } from "./util.mjs";

const OPTS = { withinArchetype: true, slotVariance: false, extraSource: false, extraTalents: false, drawbacks: false, limitChance: 0, honorTouched: false };
const NO_ATTRS = (s) => ATTRS.every((k) => s.attrs?.[k] === 2);
const roleName = (r) => (ROLES.includes(r) ? t(`IPC.Role.${r}`) : String(r ?? ""));

/** how an archetype is shown in lists: name + role */
const roleOf = (d, e) => d.arch?.[e.name]?.role || e.data?.role || "";

function status(ctx) {
  const iss = validateStep(ctx.state, "concept");
  if (!iss.issues.length) return `<p class="ipc-status ipc-ok">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Step.StatusOk"))}</p>`;
  return `<ul class="ipc-status-list">${iss.issues.map((i) => `<li class="${i.severity === "error" ? "ipc-iss-err" : "ipc-iss-warn"}">${icon("fa-solid fa-circle-exclamation")}<span>${esc(msgText(i))}</span></li>`).join("")}</ul>`;
}

function opt({ name, value, label, sub, on, fk, landed }) {
  return `<label class="ipc-opt${on ? " is-on" : ""}${landed ? " ipc-landed" : ""}">
    <input type="radio" name="${name}" value="${esc(value)}" data-fk="${esc(fk)}"${on ? " checked" : ""}>
    <span class="ipc-opt-text"><span class="ipc-opt-name">${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    ${icon("fa-solid fa-check ipc-opt-check")}
  </label>`;
}

function powerLine(p) {
  const bits = [p.name];
  if (p.level > 0) bits.push(levelName(p.level));
  const boosts = (p.boosts ?? []).map((b) => b.name);
  return `<li><span>${esc(bits.join(" · "))}</span>${boosts.length ? ` <small class="ipc-muted">+ ${esc(boosts.join(", "))}</small>` : ""}</li>`;
}

function panel(ctx) {
  const s = ctx.state, d = ctx.data;
  if (!s.archetype) return `<div class="ipc-cn-panel ipc-cn-scratch"><p>${esc(t("IPC.Concept.ScratchText"))}</p></div>`;
  const a = d.arch?.[s.archetype];
  if (!a) return `<div class="ipc-cn-panel"><p>${esc(t("IPC.Concept.NoData", { name: s.archetype }))}</p></div>`;
  const applied = d.applied === s.archetype && d.last && s.powers === d.last.powers;
  const busy = d.applying;
  return `<div class="ipc-cn-panel">
    <div class="ipc-cn-pname"><h4>${esc(a.name)}</h4>${a.role ? `<span class="ipc-cn-role">${esc(t("IPC.Concept.RoleOf", { role: roleName(a.role) }))}</span>` : ""}</div>
    <div class="ipc-cn-cols">
      <div><h5>${esc(t("IPC.Concept.Suggests"))}</h5>${a.powers?.length ? `<ul class="ipc-cn-powers">${a.powers.map(powerLine).join("")}</ul>` : `<p class="ipc-muted">-</p>`}</div>
      <div><h5>${esc(t("IPC.Concept.SuggestsAttrs"))}</h5><ul class="ipc-cn-attrs">${ATTRS.map((k) => `<li><span>${esc(attrShort(k))}</span><b>${a.attrs?.[k] ?? "-"}</b></li>`).join("")}</ul></div>
    </div>
    <p class="ipc-cn-note ipc-muted">${esc(t("IPC.Concept.Baseline"))}</p>
    <div class="ipc-cn-apply">
      <button type="button" class="ipc-btn ipc-btn-primary" data-act="apply" data-fk="apply"${busy ? ' aria-disabled="true"' : ""}>${icon(busy ? "fa-solid fa-spinner fa-spin-pulse" : "fa-solid fa-wand-sparkles")} ${esc(t(busy ? "IPC.Concept.Applying" : "IPC.Concept.Apply"))}</button>
      ${applied ? `<span class="ipc-badge-ok">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Concept.Applied"))}</span>` : ""}
    </div>
    <p class="ipc-cn-note ipc-muted">${esc(t("IPC.Concept.ApplyWhat"))}</p>
    ${d.error ? `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(d.error)}</p>` : ""}
  </div>`;
}

function diceButton(act, label, tip, busy) {
  return `<button type="button" class="ipc-btn ipc-btn-small" data-act="${act}" data-fk="${act}" data-tooltip="${esc(tip)}"${busy ? ' aria-disabled="true"' : ""}>${icon(busy ? "fa-solid fa-spinner fa-spin-pulse" : "fa-solid fa-dice")} ${esc(busy ? t("IPC.Concept.Rolling") : label)}</button>`;
}

function confirmReplace(name, what) {
  return confirmDialog({
    title: t("IPC.Concept.ConfirmTitle"),
    body: t("IPC.Concept.ConfirmBody", { name, what: what.map((w) => t(`IPC.Concept.What.${w}`)).join(", ") }),
    yes: t("IPC.Concept.ConfirmYes", { name }), no: t("IPC.Concept.ConfirmNo")
  });
}

async function applyDefaults(ctx) {
  const d = ctx.data, s0 = ctx.state, a = d.arch?.[s0.archetype];
  if (!a || d.applying) return;
  const last = d.last ?? {};
  const what = [];
  if ((s0.powers.length && s0.powers !== last.powers) || s0.touched.powers) what.push("powers");
  if ((!NO_ATTRS(s0) && s0.attrs !== last.attrs) || s0.touched.attributes) what.push("attributes");
  if (what.length && !(await confirmReplace(a.name, what))) return;
  d.applying = true; d.error = "";
  ctx.rerender();
  try {
    const P = ctx.provider();
    let s = { ...ctx.state, role: a.role || ctx.state.role };
    const pwr = await ctx.busy(rollStep(s, "powers", P, OPTS, { frozen: (f) => !["powers", "sources", "attrs"].includes(f) }));
    if (pwr === s || !pwr.powers.length) throw new Error(t("IPC.Concept.NoFit"));
    s = pwr;
    s = await ctx.busy(rollStep(s, "attributes", P, OPTS, { frozen: (f) => f !== "attrs" }));
    s = rebase(ctx.state, s0, s);
    d.applied = s.archetype; d.last = { powers: s.powers, attrs: s.attrs };
    d.applying = false;
    const sum = ATTRS.reduce((x, k) => x + s.attrs[k], 0);
    ctx.commit(s, { body: true });
    ctx.announce(t("IPC.Concept.AppliedDone", { name: a.name, powers: s.powers.map((p) => p.name).join(", "), points: sum }));
  } catch (err) {
    console.error("invincible-plus-ultra | chargen archetype apply failed", err);
    d.applying = false;
    d.error = t("IPC.Concept.ApplyFailed", { error: err?.message ?? String(err) });
    ctx.rerender();
  }
}

async function rollArchetype(ctx) {
  const d = ctx.data;
  if (d.rolling) return;
  d.rolling = "arch"; d.error = "";
  ctx.rerender();
  try {
    const before = ctx.state.archetype;
    const s0 = ctx.state;
    let s = s0;
    for (let i = 0; i < 6; i++) {          // a reroll should land somewhere new; each attempt is the next seeded draw
      const next = await ctx.busy(rollStep(s, "concept", ctx.provider(), OPTS));
      if (next === s) break;               // locked: nothing to roll
      s = next;
      if (s.archetype !== before) break;
    }
    d.rolling = null;
    if (s === s0) { ctx.rerender(); return; }
    s = rebase(ctx.state, s0, s);          // C5: edits made while the dice rolled are kept
    d.landed = `a:${s.archetype}`;
    ctx.commit(s, { body: true });
    ctx.announce(t("IPC.Concept.Rolled", { name: s.archetype, role: roleName(s.role) }));
  } catch (err) {
    console.error("invincible-plus-ultra | chargen archetype roll failed", err);
    d.rolling = null; d.error = t("IPC.Concept.RollFailed", { error: err?.message ?? String(err) });
    ctx.rerender();
  }
}

function rollRole(ctx) {
  const s = ctx.state, n = s.rerolls?.conceptRole ?? 0;
  const rng = substream(s.seed, `conceptRole:${n}`);
  const role = rng.pick(ROLES.filter((r) => r !== s.role));
  ctx.data.landed = `r:${role}`;
  ctx.update((st) => ({ ...st, role, rerolls: { ...st.rerolls, conceptRole: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Concept.RolledRole", { role: roleName(role) }));
}

export default {
  id: "concept",
  icon: "fa-solid fa-lightbulb",

  async load(ctx) {
    const d = ctx.data;
    d.list = await ctx.provider().list("archetypes", {});
    d.arch = {};
    for (const e of d.list) {
      try { const a = await ctx.catalog.getArchetype(e.name); if (a) d.arch[e.name] = a; } catch (err) { console.warn("invincible-plus-ultra | archetype read failed", e.name, err); }
    }
  },

  render(ctx) {
    const s = ctx.state, d = ctx.data, landed = d.landed;
    const list = d.list ?? [];
    const archOpts = [
      opt({ name: "archetype", value: "", label: t("IPC.Summary.Scratch"), sub: t("IPC.Concept.ScratchSub"), on: !s.archetype, fk: "arch-none" }),
      ...list.map((e, i) => opt({ name: "archetype", value: e.name, label: e.name, sub: roleName(roleOf(d, e)), on: s.archetype === e.name, fk: `arch-${i}`, landed: landed === `a:${e.name}` }))
    ].join("");
    const roleOpts = ROLES.map((r) => opt({ name: "role", value: r, label: t(`IPC.Role.${r}`), sub: t(`IPC.Role.${r}`) !== r ? r : "", on: s.role === r, fk: `role-${r}`, landed: landed === `r:${r}` })).join("");
    const idOpts = [["", t("IPC.Identity.none")], ["secret", t("IPC.Identity.secret")], ["public", t("IPC.Identity.public")]]
      .map(([v, label]) => opt({ name: "identity", value: v, label, on: (s.identity ?? "") === v, fk: `id-${v || "none"}` })).join("");
    return `<div class="ipc-concept">
      ${status(ctx)}
      <section class="ipc-cn-sec" aria-labelledby="ipc-cn-a">
        <div class="ipc-cn-head"><h3 id="ipc-cn-a">${esc(t("IPC.Concept.Archetype"))}</h3>${list.length ? diceButton("roll-arch", t("IPC.Concept.Roll"), t("IPC.Concept.RollTip"), d.rolling === "arch") : ""}</div>
        <p class="ipc-cn-sub">${esc(list.length ? t("IPC.Concept.ArchetypeHint") : t("IPC.Concept.NoArchetypes"))}</p>
        ${list.length ? `${panel(ctx)}<fieldset class="ipc-opts ipc-opts-arch"><legend class="ipc-sr">${esc(t("IPC.Concept.Archetype"))}</legend>${archOpts}</fieldset>` : ""}
      </section>
      <section class="ipc-cn-sec" aria-labelledby="ipc-cn-r">
        <div class="ipc-cn-head"><h3 id="ipc-cn-r">${esc(t("IPC.Concept.Role"))}</h3>${diceButton("roll-role", t("IPC.Concept.RollRole"), t("IPC.Concept.RollRoleTip"), false)}</div>
        <p class="ipc-cn-sub">${esc(t("IPC.Concept.RoleHint"))}</p>
        <fieldset class="ipc-opts ipc-opts-role"><legend class="ipc-sr">${esc(t("IPC.Concept.Role"))}</legend>${roleOpts}</fieldset>
      </section>
      <section class="ipc-cn-sec" aria-labelledby="ipc-cn-i">
        <div class="ipc-cn-head"><h3 id="ipc-cn-i">${esc(t("IPC.Concept.Identity"))}</h3></div>
        <p class="ipc-cn-sub">${esc(t("IPC.Concept.IdentityHint"))}</p>
        <fieldset class="ipc-opts ipc-opts-id"><legend class="ipc-sr">${esc(t("IPC.Concept.Identity"))}</legend>${idOpts}</fieldset>
      </section>
    </div>`;
  },

  mount(ctx, root) {
    const d = ctx.data;
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLInputElement) || el.type !== "radio") return;
      const s = ctx.state;
      if (el.name === "archetype") {
        const name = el.value || null;
        if (name === s.archetype) return;
        const a = name ? d.arch?.[name] : null, prev = s.archetype ? d.arch?.[s.archetype] : null;
        let role = s.role;
        if (a?.role && (!role || role === prev?.role)) role = a.role;     // keep a role the user picked by hand
        ctx.update((st) => ({ ...st, archetype: name, role }), { body: true });
        ctx.announce(name ? t("IPC.Concept.Selected", { name, role: roleName(role) }) : t("IPC.Concept.NoArchetype"));
      } else if (el.name === "role") {
        if (el.value !== s.role) ctx.update((st) => ({ ...st, role: el.value }), { body: true });
      } else if (el.name === "identity") {
        const v = el.value || null;
        if (v !== s.identity) ctx.update((st) => ({ ...st, identity: v }), { body: true });
      }
    });
    delegate(root, "click", "[data-act]", (ev, el) => {
      if (el.getAttribute("aria-disabled") === "true") return;
      const act = el.dataset.act;
      if (act === "apply") applyDefaults(ctx);
      else if (act === "roll-arch") rollArchetype(ctx);
      else if (act === "roll-role") rollRole(ctx);
    });
    // the freshly rolled option scrolls into view and gets its one-time landing animation (class set by render)
    if (d.landed) { requestAnimationFrame(() => root.querySelector(".ipc-landed")?.scrollIntoView({ block: "nearest" })); d.landed = null; }
  },

  onState(ctx) { ctx.data.error = ""; ctx.data.landed = null; }
};
