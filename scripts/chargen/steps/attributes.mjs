/* Step "attributes" (phase 5d): spend EVERY attribute point (user decision: leftover and overspend both block Apply).
   Layout (one column that scrolls in the wizard body, same grammar as powers / talents): sticky points meter (states: unspent / perfect / over, always
   icon + words) -> "where your N points come from" (rank base, power slots, extra sources, extra talents, drawbacks; links to the steps that change them)
   -> tools (Auto-balance with an explained PREVIEW, Spread evenly, Distribute randomly, Reset to archetype) -> six attribute rows in two groups
   (physical / mental) -> "what these attributes give you" (Health / Resolve / Slugfest with the origin of every bonus, from bonuses.mjs).
   NO re-render on edits: the skeleton is built once by render(); sync() patches text / classes / aria in place after every change, so the controls keep
   focus and nothing flickers. Only the small panels (status line, balance preview, message line) are repainted as regions.
   RULES (arithmetic in rules.mjs): 1..cap per attribute (cap by rank); budget = rank points + 2 per free power slot - extra sources - extra talents + drawbacks;
   raising is refused when no point is left or the cap is reached (the reason is printed), lowering is always possible down to 1. The Massive / Monstrous
   restrictions of the book concern power levels only, not attributes (spec 1.3), so nothing of that applies here.
   DICE: Distribute randomly = seeded substream `attrDist:<n>` (counter state.rerolls.attrDist, bumped in the same commit: undo + roll again = the same result);
   per-attribute LOCKS live in state.locks["attrs.<name>"] and hold a value while distributing (randomly or evenly). Auto-balance and Reset ignore locks.
   Descriptions of the six attributes are read at RUNTIME from the book page (never stored); descriptor words come from the system's own labels. */
import { t } from "../lang.mjs";
import { ATTRS, ATTR_MIN, attributeBudget, budget, slots, extraSources, derive, reconcileAttributes, validateStep, attrSum } from "../rules.mjs";
import { setAttr, setAttrs, toggleLock } from "../state.mjs";
import { substream } from "../rng.mjs";
import { fxOf, itemRefs, warmBonuses } from "../bonuses.mjs";
import { esc, icon, msgText, attrLabel, attrShort, rankName, delegate } from "./util.mjs";

const BOOK = "Compendium.invincible-core.core-book.JournalEntry.Rbx4P6GQT5EoFNUG";
const BOOK_PAGE = "5Rh9ZCOMsoTBYxc2";
const GROUPS = [
  { id: "physical", attrs: ["fighting", "agility", "strength"] },
  { id: "mental", attrs: ["reason", "intuition", "presence"] }
];
const lockKey = (k) => `attrs.${k}`;
const signed = (v) => (v > 0 ? `+${v}` : String(v));
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

/** descriptor word of a score: the system's own label in English, our table in Polish (the system ships English only) */
function word(n) {
  const key = `INVINCIBLE.Actor.base.FIELDS.attributes.graduation.${n}`;
  try { if (game.i18n.lang !== "pl" && game.i18n.has(key)) return game.i18n.localize(key); } catch { /* fall through */ }
  return t(`IPC.Grad.${n}`);
}

/* ---------------------------------------------------------------- runtime book text */
async function readDescs() {
  const out = {};
  try {
    const j = await fromUuid(BOOK);
    const pages = [j?.pages?.get(BOOK_PAGE), ...(j?.pages?.contents ?? [])].filter(Boolean);
    for (const p of pages) {
      const html = p.text?.content;
      if (!html || !/FIGHTING/.test(html)) continue;
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const li of doc.querySelectorAll("li")) {
        const label = li.querySelector(".bold, strong, b");
        const name = (label?.textContent ?? "").replace(/[:\s]+$/g, "").trim().toLowerCase();
        if (!ATTRS.includes(name) || out[name]) continue;
        let txt = li.textContent.replace(/\s+/g, " ").trim().replace(/^[^:]*:\s*/, "");
        if (txt.length > 120) txt = `${txt.slice(0, 117).replace(/\s+\S*$/, "")}...`;
        out[name] = txt;
      }
      if (Object.keys(out).length === ATTRS.length) break;
    }
  } catch (err) { console.warn("invincible-plus-ultra | chargen: attribute descriptions unavailable", err); }
  return out;
}

/* ---------------------------------------------------------------- pure helpers (no DOM) */
function bonusSources(state, field) {
  return itemRefs(state).map(({ type, ref }) => ({ name: ref.name, v: fxOf(type, ref)?.[field] ?? 0 })).filter((x) => x.v);
}

/** what Auto-balance would do: { ok, attrs, changes:[{k,from,to,cap}], diff, clamped } */
function planBalance(ctx) {
  const s = ctx.state, cap = ctx.rank.cap, B = budget(s);
  const r = reconcileAttributes(s.attrs, B, cap);
  const changes = ATTRS.filter((k) => r.attrs[k] !== s.attrs[k]).map((k) => ({ k, from: s.attrs[k], to: r.attrs[k], capped: s.attrs[k] > cap }));
  return { ok: r.ok, attrs: r.attrs, changes, diff: B - attrSum(s.attrs), clamped: ATTRS.some((k) => s.attrs[k] > cap), budget: B, cap };
}

/** distribute the points the locks leave over; mode "random" | "even". Returns { attrs } or { error:{key,params} } */
function distribute(ctx, mode, rng) {
  const s = ctx.state, cap = ctx.rank.cap, B = budget(s);
  const locked = ATTRS.filter((k) => s.locks?.[lockKey(k)]);
  const free = ATTRS.filter((k) => !locked.includes(k));
  if (!free.length) return { error: { key: "IPC.Attrs.Msg.AllLocked", params: {} } };
  const R = B - locked.reduce((a, k) => a + s.attrs[k], 0);
  const lo = free.length * ATTR_MIN, hi = free.length * cap;
  if (R < lo || R > hi) return { error: { key: "IPC.Attrs.Msg.Infeasible", params: { n: R, lo, hi } } };
  const vals = Object.fromEntries(free.map((k) => [k, R >= free.length * 2 ? 2 : ATTR_MIN]));   // start from a civilian 2 when the budget allows
  let left = R - free.length * vals[free[0]];
  if (mode === "even") {
    while (left > 0) { let moved = false; for (const k of free) if (left > 0 && vals[k] < cap) { vals[k]++; left--; moved = true; } if (!moved) break; }
  } else {
    while (left > 0) {
      const open = free.filter((k) => vals[k] < cap);
      if (!open.length) break;
      const k = rng.weighted(open, (x) => vals[x] * vals[x]);   // the strong get stronger: a spread, not a flat hero
      vals[k]++; left--;
    }
  }
  return { attrs: { ...s.attrs, ...vals } };
}

/* ---------------------------------------------------------------- skeleton (built once) */
function statusHtml(ctx) {
  const iss = validateStep(ctx.state, "attributes");
  if (!iss.issues.length) return `<p class="ipc-status ipc-ok">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Step.StatusOk"))}</p>`;
  const cls = (i) => (i.severity === "error" ? "ipc-iss-err" : i.severity === "info" ? "ipc-iss-info" : "ipc-iss-warn");
  const rest = iss.issues.filter((i) => i.code !== "attr.unspent" && i.code !== "attr.over");   // the points meter below says those two in full
  if (!rest.length) return "";
  return `<ul class="ipc-status-list">${rest.map((i) => `<li class="${cls(i)}">${icon("fa-solid fa-circle-exclamation")}<span>${esc(msgText(i))}</span></li>`).join("")}</ul>`;
}

function rowHtml(ctx, k) {
  const cap = ctx.rank.cap, name = attrLabel(k);
  const cells = Array.from({ length: cap }, (_, i) => `<span class="ipc-at-cell" data-act="cell" data-k="${k}" data-v="${i + 1}"></span>`).join("");
  return `<li class="ipc-at-row" data-k="${k}">
    <div class="ipc-at-id">
      <span class="ipc-at-name" id="ipc-at-l-${k}">${esc(name)}</span>
      <span class="ipc-at-word" data-r="word"></span>
      <p class="ipc-at-desc" data-r="desc" hidden></p>
    </div>
    <div class="ipc-at-ctl">
      <button type="button" class="ipc-at-step" data-act="dec" data-k="${k}" tabindex="-1" aria-label="${esc(t("IPC.Attrs.Row.Dec", { attr: name }))}" data-tooltip="${esc(t("IPC.Attrs.Row.Dec", { attr: name }))}">${icon("fa-solid fa-minus")}</button>
      <div class="ipc-at-val" role="spinbutton" tabindex="0" data-k="${k}" data-fk="at-${k}" aria-labelledby="ipc-at-l-${k}" aria-valuemin="${ATTR_MIN}" aria-valuemax="${cap}" aria-valuenow="0"><b data-r="num">0</b></div>
      <button type="button" class="ipc-at-step" data-act="inc" data-k="${k}" tabindex="-1" aria-label="${esc(t("IPC.Attrs.Row.Inc", { attr: name }))}" data-tooltip="${esc(t("IPC.Attrs.Row.Inc", { attr: name }))}">${icon("fa-solid fa-plus")}</button>
    </div>
    <div class="ipc-at-bar" aria-hidden="true">${cells}</div>
    <div class="ipc-at-side">
      <span class="ipc-at-arch" data-r="arch" hidden></span>
      <span class="ipc-at-flag" data-r="flag" hidden>${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Attrs.Row.AboveCap", { cap }))}</span>
      <button type="button" class="ipc-at-lock" data-act="lock" data-k="${k}" data-fk="lock-${k}" aria-pressed="false"></button>
    </div>
  </li>`;
}

function groupHtml(ctx, g) {
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-at-h-${g.id}">
    <div class="ipc-cn-head"><h3 id="ipc-at-h-${g.id}" tabindex="-1">${esc(t(`IPC.Attrs.Group.${g.id}`))}</h3></div>
    <p class="ipc-cn-sub">${esc(t(`IPC.Attrs.Group.${g.id}.Sub`))}</p>
    <ul class="ipc-at-rows">${g.attrs.map((k) => rowHtml(ctx, k)).join("")}</ul>
  </section>`;
}

function derivedHtml() {
  const rows = [
    { id: "health", label: "IPC.Preview.Health", how: "IPC.Attrs.Der.Health" },
    { id: "resolve", label: "IPC.Preview.Resolve", how: "IPC.Attrs.Der.Resolve" },
    { id: "slugfest", label: "IPC.Preview.Slugfest", how: "IPC.Attrs.Der.Slugfest" }
  ];
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-at-h-der">
    <div class="ipc-cn-head"><h3 id="ipc-at-h-der" tabindex="-1">${esc(t("IPC.Attrs.Der.Title"))}</h3></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Attrs.Der.Sub"))}</p>
    <ul class="ipc-at-der">${rows.map((r) => `<li data-der="${r.id}"><span class="ipc-at-der-n" data-r="n">0</span><div><b>${esc(t(r.label))}</b><p data-r="how"></p><p class="ipc-at-der-fx" data-r="fx"></p></div></li>`).join("")}</ul>
    <p class="ipc-muted ipc-at-foot">${esc(t("IPC.Attrs.Der.Foot"))}</p>
  </section>`;
}

/* ---------------------------------------------------------------- patching in place */
const setText = (el, v) => { if (el && el.textContent !== String(v)) el.textContent = v; };
const setAttr_ = (el, name, v) => { if (el && el.getAttribute(name) !== String(v)) el.setAttribute(name, v); };
const toggleHidden = (el, hide) => { if (el) el.hidden = !!hide; };

function paintRegions(ctx, root) {
  const d = ctx.data;
  const st = root.querySelector('[data-r="status"]');
  const html = statusHtml(ctx);
  if (st && st.dataset.html !== html) { st.innerHTML = html; st.dataset.html = html; }
  const msg = root.querySelector('[data-r="msg"]');
  if (msg) { const v = d.msg ?? ""; if (msg.dataset.v !== v) { msg.dataset.v = v; msg.innerHTML = v ? `${icon("fa-solid fa-circle-info")} ${esc(v)}` : ""; } }
  const bal = root.querySelector('[data-r="balance"]');
  if (bal) {
    const html2 = d.preview ? balanceHtml(ctx) : "";
    if (bal.dataset.html !== html2) { bal.innerHTML = html2; bal.dataset.html = html2; }
  }
}

function balanceHtml(ctx) {
  const p = ctx.data.preview;
  if (!p) return "";
  if (!p.ok) return `<div class="ipc-note-box ipc-at-prev" role="status">${icon("fa-solid fa-circle-exclamation")} ${esc(t("IPC.Attrs.Balance.Impossible", { budget: p.budget, cap: p.cap }))}<div class="ipc-actions"><button type="button" class="ipc-btn ipc-btn-small" data-act="balance-cancel" data-fk="bal-cancel">${esc(t("IPC.Attrs.Balance.Close"))}</button></div></div>`;
  if (!p.changes.length) return `<div class="ipc-note-box ipc-at-prev" role="status">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Attrs.Balance.None"))}<div class="ipc-actions"><button type="button" class="ipc-btn ipc-btn-small" data-act="balance-cancel" data-fk="bal-cancel">${esc(t("IPC.Attrs.Balance.Close"))}</button></div></div>`;
  const why = [];
  if (p.clamped) why.push(t("IPC.Attrs.Balance.Clamp", { cap: p.cap }));
  if (p.diff > 0) why.push(t("IPC.Attrs.Balance.Add", { n: p.diff }));
  else if (p.diff < 0) why.push(t("IPC.Attrs.Balance.Remove", { n: -p.diff }));
  return `<div class="ipc-note-box ipc-at-prev" role="group" aria-label="${esc(t("IPC.Attrs.Balance.Title"))}">
    <h4>${esc(t("IPC.Attrs.Balance.Title"))}</h4>
    <p>${esc(why.join(" "))}</p>
    <ul class="ipc-at-changes">${p.changes.map((c) => `<li><b>${esc(attrLabel(c.k))}</b> <span class="ipc-at-from">${c.from}</span> ${icon("fa-solid fa-arrow-right")} <span class="ipc-at-to">${c.to}</span></li>`).join("")}</ul>
    <div class="ipc-actions"><button type="button" class="ipc-btn ipc-btn-small ipc-btn-primary" data-act="balance-apply" data-fk="bal-apply">${icon("fa-solid fa-check")} ${esc(t("IPC.Attrs.Balance.Apply"))}</button><button type="button" class="ipc-btn ipc-btn-small" data-act="balance-cancel" data-fk="bal-cancel">${esc(t("IPC.Attrs.Balance.Cancel"))}</button></div>
  </div>`;
}

function archTarget(ctx) {
  const d = ctx.data;
  if (!d.arch?.attrs) return null;
  const r = reconcileAttributes(d.arch.attrs, budget(ctx.state), ctx.rank.cap);
  return r.ok ? r.attrs : null;
}

/** patch every dynamic bit of the step from ctx.state */
function sync(ctx, root) {
  if (!root?.isConnected) return;
  const s = ctx.state, r = ctx.rank, d = ctx.data, b = attributeBudget(s);
  const left = b.left, state = left > 0 ? "unspent" : left < 0 ? "over" : "perfect";
  const tgt = archTarget(ctx);

  // meter
  const meter = root.querySelector(".ipc-at-meter");
  meter.className = `ipc-at-meter is-${state}`;
  setText(meter.querySelector('[data-r="left"]'), Math.abs(left));
  setText(meter.querySelector('[data-r="leftlabel"]'), left < 0 ? t("IPC.Attrs.Meter.OverWord") : t("IPC.Attrs.Meter.LeftWord"));
  const stateIcon = state === "perfect" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation";
  const stateText = state === "perfect" ? t("IPC.Attrs.State.Perfect") : state === "unspent" ? t("IPC.Attrs.State.Unspent", { n: left }) : t("IPC.Attrs.State.Over", { n: -left });
  const stEl = meter.querySelector('[data-r="state"]');
  if (stEl.dataset.v !== stateText) { stEl.dataset.v = stateText; stEl.innerHTML = `${icon(stateIcon)} ${esc(stateText)}`; }
  setText(meter.querySelector('[data-r="spent"]'), `${t("IPC.Attrs.Meter.Spent", { spent: b.spent, budget: b.budget })} · ${t("IPC.Attrs.Meter.Cap", { cap: r.cap })}`);
  const fill = meter.querySelector('[data-r="fill"]');
  fill.style.transform = `scaleX(${b.budget > 0 ? Math.max(0, Math.min(1, b.spent / b.budget)) : 0})`;

  // where the points come from
  const free = r.powers - slots(s), x = extraSources(s), e = s.extraTalents.length, dr = s.drawbacks.length;
  const src = [
    { label: t("IPC.Attrs.Src.Base", { rank: rankName(s.rank) }), v: r.points, go: null },
    { label: t("IPC.Attrs.Src.Slots", { used: slots(s), max: r.powers }), v: 2 * free, go: "powers" },
    x ? { label: t("IPC.Attrs.Src.Sources", { n: x }), v: -x, go: "powers" } : null,
    e ? { label: t("IPC.Attrs.Src.Talents", { n: e }), v: -e, go: "talents" } : null,
    dr ? { label: t("IPC.Attrs.Src.Drawbacks", { n: dr }), v: dr, go: "talents" } : null
  ].filter(Boolean);
  const srcHtml = `${src.map((p, i) => `<li><span>${esc(p.label)}</span><b class="${p.v < 0 ? "is-neg" : ""}">${i === 0 ? p.v : signed(p.v)}</b>${p.go ? `<button type="button" class="ipc-link" data-act="go-${p.go}" data-fk="go-${p.go}-${i}">${esc(t(p.go === "powers" ? "IPC.Attrs.Src.GoPowers" : "IPC.Attrs.Src.GoTalents"))}</button>` : "<span></span>"}</li>`).join("")}<li class="ipc-at-total"><span>${esc(t("IPC.Attrs.Src.Total"))}</span><b>${b.budget}</b><span></span></li>`;
  const srcEl = root.querySelector('[data-r="src"]');
  if (srcEl.dataset.html !== srcHtml) { srcEl.innerHTML = srcHtml; srcEl.dataset.html = srcHtml; }

  // rows
  for (const k of ATTRS) {
    const row = root.querySelector(`.ipc-at-row[data-k="${k}"]`);
    const v = s.attrs[k] ?? 0, locked = !!s.locks?.[lockKey(k)], above = v > r.cap;
    const w = word(v);
    setText(row.querySelector('[data-r="num"]'), v);
    setText(row.querySelector('[data-r="word"]'), w);
    const sp = row.querySelector('[role="spinbutton"]');
    setAttr_(sp, "aria-valuenow", v);
    setAttr_(sp, "aria-valuetext", t("IPC.Attrs.Row.ValueText", { n: v, word: w }));
    setAttr_(sp, "aria-valuemax", Math.max(r.cap, v));
    row.classList.toggle("is-above", above);
    toggleHidden(row.querySelector('[data-r="flag"]'), !above);
    row.querySelector('[data-act="inc"]').setAttribute("aria-disabled", String(!(v < r.cap && left > 0)));
    row.querySelector('[data-act="dec"]').setAttribute("aria-disabled", String(v <= ATTR_MIN));
    row.querySelectorAll(".ipc-at-cell").forEach((c, i) => {
      c.classList.toggle("is-on", i < v);
      c.classList.toggle("is-arch", !!tgt && i + 1 === tgt[k]);
    });
    const arch = row.querySelector('[data-r="arch"]');
    if (tgt) { toggleHidden(arch, false); setText(arch, t("IPC.Attrs.Row.Arch", { n: tgt[k] })); } else toggleHidden(arch, true);
    const lock = row.querySelector('[data-act="lock"]');
    const lockLbl = t(locked ? "IPC.Attrs.Lock.Unlock" : "IPC.Attrs.Lock.Lock", { attr: attrLabel(k) });
    setAttr_(lock, "aria-pressed", locked);
    setAttr_(lock, "aria-label", lockLbl); setAttr_(lock, "data-tooltip", lockLbl);
    const lockHtml = icon(locked ? "fa-solid fa-lock" : "fa-solid fa-lock-open");
    if (lock.dataset.i !== String(locked)) { lock.dataset.i = String(locked); lock.innerHTML = lockHtml; }
    row.classList.toggle("is-locked", locked);
    const desc = row.querySelector('[data-r="desc"]');
    if (d.descs?.[k]) { setText(desc, d.descs[k]); toggleHidden(desc, false); }
  }

  // tools
  const cur = tgt && ATTRS.every((k) => s.attrs[k] === tgt[k]);
  const reset = root.querySelector('[data-act="reset"]');
  reset.setAttribute("aria-disabled", String(!tgt));
  setAttr_(reset, "data-tooltip", tgt ? t("IPC.Attrs.Tools.ResetTip", { name: s.archetype }) : (s.archetype ? t("IPC.Attrs.Arch.NoData") : t("IPC.Attrs.Arch.None")));
  const badge = root.querySelector('[data-r="archbadge"]');
  if (tgt) {
    toggleHidden(badge, false);
    badge.className = `ipc-at-archbadge ${cur ? "is-match" : "is-diff"}`;
    badge.innerHTML = `${icon(cur ? "fa-solid fa-check" : "fa-solid fa-pen")} ${esc(t(cur ? "IPC.Attrs.Arch.Matches" : "IPC.Attrs.Arch.Differs", { name: s.archetype }))}`;
  } else toggleHidden(badge, true);
  const lockedN = ATTRS.filter((k) => s.locks?.[lockKey(k)]).length;
  setText(root.querySelector('[data-r="lockinfo"]'), lockedN ? t("IPC.Attrs.Lock.Count", { n: lockedN }) : t("IPC.Attrs.Lock.Hint"));

  // derived
  const dv = derive(s, ctx.app.bonuses);
  const base = derive(s, {});
  const parts = {
    health: t("IPC.Attrs.Der.Health", { a: attrShort("fighting"), b: attrShort("agility"), c: attrShort("strength"), base: base.health }),
    resolve: t("IPC.Attrs.Der.Resolve", { a: attrShort("reason"), b: attrShort("intuition"), c: attrShort("presence"), base: base.resolve }),
    slugfest: t("IPC.Attrs.Der.Slugfest", { a: attrShort("strength"), base: base.slugfest })
  };
  for (const f of ["health", "resolve", "slugfest"]) {
    const li = root.querySelector(`[data-der="${f}"]`), n = li.querySelector('[data-r="n"]');
    const srcs = bonusSources(s, f);
    if (n.textContent !== String(dv[f])) {
      const had = n.textContent !== "0" || d.derPainted;
      n.textContent = dv[f];
      if (had && !reduced()) { n.classList.remove("ipc-pop"); void n.offsetWidth; n.classList.add("ipc-pop"); n.addEventListener("animationend", () => n.classList.remove("ipc-pop"), { once: true }); }
    }
    setText(li.querySelector('[data-r="how"]'), parts[f]);
    const fxEl = li.querySelector('[data-r="fx"]');
    setText(fxEl, srcs.map((x) => t("IPC.Attrs.Der.Bonus", { v: signed(x.v), name: x.name })).join(", "));
    toggleHidden(fxEl, !srcs.length);
  }
  d.derPainted = true;
  paintRegions(ctx, root);
}

/* ---------------------------------------------------------------- actions */
function say(ctx, root, text) { ctx.data.msg = text; paintRegions(ctx, root); }

function setValue(ctx, root, k, next, { coalesce = true } = {}) {
  const s = ctx.state, r = ctx.rank, cur = s.attrs[k], left = attributeBudget(s).left;
  const maxNow = Math.max(cur, Math.min(r.cap, cur + Math.max(0, left)));
  if (next > cur && next > maxNow) {
    say(ctx, root, cur >= r.cap ? t("IPC.Attrs.Msg.AtCap", { attr: attrLabel(k), cap: r.cap }) : t("IPC.Attrs.Msg.NoPoints"));
    return false;
  }
  if (next < ATTR_MIN) { say(ctx, root, t("IPC.Attrs.Msg.AtMin", { attr: attrLabel(k), min: ATTR_MIN })); return false; }
  if (next === cur) return false;
  ctx.data.msg = ""; ctx.data.preview = null;
  ctx.update((st) => setAttr(st, k, next), coalesce ? { coalesce: `attr-${k}` } : {});
  sync(ctx, root);
  return true;
}

function commitSet(ctx, root, attrs, msg, extra = (st) => st) {
  ctx.data.msg = msg; ctx.data.preview = null;
  ctx.update((st) => extra(setAttrs(st, attrs)));
  sync(ctx, root);
  ctx.announce(`${msg} ${t("IPC.Preview.LeftLive", { n: attributeBudget(ctx.state).left })}`);
}

function doRandom(ctx, root) {
  const s = ctx.state, n = s.rerolls?.attrDist ?? 0;
  let res = null;
  for (let tryN = 0; tryN < 6; tryN++) {                      // re-draw a few times so a roll does not land on the current spread
    res = distribute(ctx, "random", substream(s.seed, `attrDist:${n}:${tryN}`));
    if (res.error || ATTRS.some((k) => res.attrs[k] !== s.attrs[k])) break;
  }
  if (res.error) return say(ctx, root, t(res.error.key, res.error.params));
  commitSet(ctx, root, res.attrs, t("IPC.Attrs.Msg.Rolled", { n: n + 1 }), (st) => ({ ...st, rerolls: { ...st.rerolls, attrDist: n + 1 } }));
}

function doSpread(ctx, root) {
  const res = distribute(ctx, "even");
  if (res.error) return say(ctx, root, t(res.error.key, res.error.params));
  commitSet(ctx, root, res.attrs, t("IPC.Attrs.Msg.Even"));
}

function doReset(ctx, root) {
  const tgt = archTarget(ctx);
  if (!tgt) return say(ctx, root, ctx.state.archetype ? t("IPC.Attrs.Arch.NoData") : t("IPC.Attrs.Arch.None"));
  commitSet(ctx, root, tgt, t("IPC.Attrs.Msg.Reset", { name: ctx.state.archetype }));
}

/* ---------------------------------------------------------------- the step */
export default {
  id: "attributes",
  icon: "fa-solid fa-dumbbell",

  async load(ctx) {
    Object.assign(ctx.data, { descs: {}, arch: null, archFor: undefined, msg: "", preview: null, derPainted: false });
    ctx.data.descs = await readDescs();
  },

  render(ctx) {
    ctx.data.preview = null;
    return `<div class="ipc-powers ipc-attrs">
      <div data-r="status"></div>
      <div class="ipc-at-meter" role="group" aria-label="${esc(t("IPC.Attrs.Meter.Label"))}">
        <div class="ipc-at-num"><b data-r="left">0</b><span data-r="leftlabel"></span></div>
        <div class="ipc-at-mtext">
          <p class="ipc-at-state" data-r="state" role="status"></p>
          <div class="ipc-at-track" aria-hidden="true"><span data-r="fill"></span></div>
          <p class="ipc-muted ipc-at-spent" data-r="spent"></p>
        </div>
      </div>
      <section class="ipc-pw-sec" aria-labelledby="ipc-at-h-src">
        <div class="ipc-cn-head"><h3 id="ipc-at-h-src" tabindex="-1">${esc(t("IPC.Attrs.Src.Title"))}</h3></div>
        <ul class="ipc-at-src" data-r="src"></ul>
        <p class="ipc-muted ipc-at-foot">${esc(t("IPC.Attrs.Src.Hint"))}</p>
      </section>
      <section class="ipc-pw-sec" aria-labelledby="ipc-at-h-tools">
        <div class="ipc-cn-head"><h3 id="ipc-at-h-tools" tabindex="-1">${esc(t("IPC.Attrs.Tools.Title"))}</h3><span class="ipc-at-archbadge" data-r="archbadge" hidden></span></div>
        <p class="ipc-cn-sub">${esc(t("IPC.Attrs.Tools.Sub"))}</p>
        <div class="ipc-at-tools">
          <button type="button" class="ipc-btn ipc-btn-small" data-act="balance" data-fk="balance" data-tooltip="${esc(t("IPC.Attrs.Tools.BalanceTip"))}">${icon("fa-solid fa-scale-balanced")} ${esc(t("IPC.Attrs.Tools.Balance"))}</button>
          <button type="button" class="ipc-btn ipc-btn-small" data-act="spread" data-fk="spread" data-tooltip="${esc(t("IPC.Attrs.Tools.SpreadTip"))}">${icon("fa-solid fa-grip-lines")} ${esc(t("IPC.Attrs.Tools.Spread"))}</button>
          <button type="button" class="ipc-btn ipc-btn-small" data-act="random" data-fk="random" data-tooltip="${esc(t("IPC.Attrs.Tools.RandomTip"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Attrs.Tools.Random"))}</button>
          <button type="button" class="ipc-btn ipc-btn-small" data-act="reset" data-fk="reset">${icon("fa-solid fa-rotate-left")} ${esc(t("IPC.Attrs.Tools.Reset"))}</button>
        </div>
        <p class="ipc-pw-msg ipc-at-msg" data-r="msg" role="status"></p>
        <div data-r="balance"></div>
        <p class="ipc-muted ipc-at-foot" data-r="lockinfo"></p>
      </section>
      ${GROUPS.map((g) => groupHtml(ctx, g)).join("")}
      ${derivedHtml()}
    </div>`;
  },

  mount(ctx, root) {
    const d = ctx.data;
    sync(ctx, root);
    // the archetype's book numbers and the talent effects arrive asynchronously: patch again when they are known
    const name = ctx.state.archetype ?? null;
    if (name && d.archFor !== name) {
      d.archFor = name;
      Promise.resolve(ctx.catalog.getArchetype(name)).then((a) => { if (d.archFor === name) { d.arch = a?.attrs ? a : null; sync(ctx, root); } }).catch(() => { d.arch = null; });
    } else if (!name) { d.arch = null; d.archFor = null; sync(ctx, root); }
    warmBonuses(ctx.state, ctx.catalog).then((grew) => { if (grew) sync(ctx, root); }).catch(() => {});

    root.addEventListener("keydown", (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLElement) || el.getAttribute("role") !== "spinbutton") return;
      const k = el.dataset.k, s = ctx.state, cur = s.attrs[k], r = ctx.rank, left = attributeBudget(s).left;
      let next = null;
      switch (ev.key) {
        case "ArrowUp": case "ArrowRight": next = cur + 1; break;
        case "ArrowDown": case "ArrowLeft": next = cur - 1; break;
        case "PageUp": next = cur + 3; break;
        case "PageDown": next = cur - 3; break;
        case "Home": next = ATTR_MIN; break;
        case "End": next = Math.max(cur, Math.min(r.cap, cur + Math.max(0, left))); break;
        default: return;
      }
      ev.preventDefault();
      if (ev.key === "PageUp") next = Math.min(next, Math.max(cur, Math.min(r.cap, cur + Math.max(0, left))));
      next = Math.max(ATTR_MIN, next);
      setValue(ctx, root, k, next);
    });

    delegate(root, "click", "[data-act]", (ev, el) => {
      const act = el.dataset.act, k = el.dataset.k, s = ctx.state;
      switch (act) {
        case "inc": setValue(ctx, root, k, s.attrs[k] + 1); break;
        case "dec": setValue(ctx, root, k, s.attrs[k] - 1); break;
        case "cell": { const v = Number(el.dataset.v); if (v !== s.attrs[k]) setValue(ctx, root, k, v); root.querySelector(`[data-fk="at-${k}"]`)?.focus({ preventScroll: true }); break; }
        case "lock": ctx.data.msg = ""; ctx.update((st) => toggleLock(st, lockKey(k)), { touch: false }); sync(ctx, root); break;
        case "balance": {
          if (d.preview) { d.preview = null; paintRegions(ctx, root); break; }
          d.msg = ""; d.preview = planBalance(ctx); paintRegions(ctx, root);
          requestAnimationFrame(() => root.querySelector('[data-fk="bal-apply"], [data-fk="bal-cancel"]')?.focus({ preventScroll: false }));
          break;
        }
        case "balance-apply": {
          const p = d.preview; if (!p?.ok) break;
          commitSet(ctx, root, p.attrs, t("IPC.Attrs.Msg.Balanced"));
          requestAnimationFrame(() => root.querySelector('[data-fk="balance"]')?.focus({ preventScroll: true }));
          break;
        }
        case "balance-cancel": d.preview = null; paintRegions(ctx, root); requestAnimationFrame(() => root.querySelector('[data-fk="balance"]')?.focus({ preventScroll: true })); break;
        case "spread": doSpread(ctx, root); break;
        case "random": doRandom(ctx, root); break;
        case "reset": if (el.getAttribute("aria-disabled") === "true") { say(ctx, root, s.archetype ? t("IPC.Attrs.Arch.NoData") : t("IPC.Attrs.Arch.None")); break; } doReset(ctx, root); break;
        case "go-powers": ctx.go("powers"); break;
        case "go-talents": ctx.go("talents"); break;
        default: break;
      }
    });
  },

  onState(ctx) {
    const d = ctx.data;
    if (!d.descs) return;
    d.msg = ""; d.preview = null; d.archFor = undefined;
  }
};
