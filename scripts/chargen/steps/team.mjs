/* Step "team" (phase 5f): TEAM NAME, the team's BASE (kind + location), STARTING UPGRADES by rank, and the second KEY RELATIONSHIP (another hero),
   tied to the real TEAM BASE ACTOR (scripts/base): the hero can stay "text only", JOIN an existing base, or CREATE a new one.
   The step never writes to any actor (like every step): it only fills state.team { name, base (kind), where, upgrades[], mode, baseId } and state.heroRel;
   apply.mjs carries the choice out AFTER the hero is written (create/link the base, add the starting upgrades, mirror the texts) and rolls back on failure.
   - mode "text": the old behaviour, the typed texts go to the hero's Team / Team base fields.
   - mode "join": pick one of the base actors the user can see; the card owns name / kind / location; extra starting upgrades may be added up to the allowance
     LEFT at the team rank (highest of the card's rank and this hero's wizard rank).
   - mode "create": a new base actor named after the team, this hero its first member; allowance = the wizard rank's (0/1/2/3).
   - hero already a MEMBER (api.base.find(actor)): the two texts are read-only and follow the card (base/lock.mjs); an Open button leads to the card.
   DICE (seeded substreams, counters in state.rerolls, undo restores them): teamName (the book's ten names), teamKind (team-base.<rank> table list),
   teamWhere (a D66 on the City Locations table, read at runtime), heroRel (a hero of this table). Book text is read at runtime, never stored. */
import { t } from "../lang.mjs";
import { RANKS, RANK_ORDER, validateStep, normName } from "../rules.mjs";
import { substream } from "../rng.mjs";
import { esc, icon, msgText, delegate, rankName } from "./util.mjs";
import { bindAutosave, chip, plain } from "./shared.mjs";

const MOD = "invincible-plus-ultra";
const nm = normName;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const bapi = () => globalThis.game?.modules?.get(MOD)?.api?.base ?? null;

/** the team part of a state with every field defaulted (older drafts and random.mjs write only name / base / upgrades) */
export const teamOf = (s) => ({ name: "", base: "", where: "", upgrades: [], mode: "text", baseId: null, ...(s?.team ?? {}) });
const splitUp = (s) => { const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(String(s ?? "").trim()); return m ? { name: m[1].trim(), power: m[2].trim() } : { name: String(s ?? "").trim(), power: "" }; };
const joinUp = (name, power) => (power ? `${name} (${power})` : name);

/* ---------------------------------------------------------------- live facts about the base feature */
function liveCard(ctx) { try { return bapi()?.find?.(ctx.actor) ?? null; } catch { return null; } }
function visibleBases() {
  const b = bapi();
  if (!b) return [];
  try { return b.list().filter((v) => game.actors.get(v.id)?.testUserPermission(game.user, "LIMITED")).sort((x, y) => x.name.localeCompare(y.name)); } catch { return []; }
}
function canCreate() {
  const b = bapi();
  try { return !!b && (b.isStaff() || game.settings.get(MOD, "basePlayersCreate") === true); } catch { return false; }
}
const effMode = (T, card) => (card ? "member" : T.mode === "join" || T.mode === "create" ? T.mode : "text");
const maxRank = (a, b) => (RANK_ORDER.indexOf(a) >= RANK_ORDER.indexOf(b) ? a : b);
const countOf = (map) => Object.keys(map ?? {}).length;

/** starting-upgrade allowance for the current mode: { total, used (already on the joined card), picks, left, rank } */
function allowanceOf(ctx, T, mode) {
  const b = bapi(), s = ctx.state, picks = T.upgrades.length;
  if (mode === "join") {
    const v = T.baseId && b ? b.get(T.baseId) : null;
    if (!v) return { total: 0, used: 0, picks, left: 0, rank: s.rank, known: false };
    const rank = maxRank(RANKS[v.rank] ? v.rank : s.rank, s.rank);
    const a = b.pure.allowance(rank, v.upgrades);
    return { total: a.total, used: a.used, picks, left: a.total - a.used - picks, rank, known: true };
  }
  const total = RANKS[s.rank]?.upgrades ?? 0;
  return { total, used: 0, picks, left: total - picks, rank: s.rank, known: true };
}

/* ---------------------------------------------------------------- upgrade rules (the same pure functions the base uses) */
const catEntry = (d, name) => d.cat.find((u) => nm(u.name) === nm(name)) ?? null;
function ownedFor(ctx, T, mode) {
  const b = bapi(), d = ctx.data;
  const card = mode === "join" && T.baseId && b ? b.get(T.baseId) : null;
  const base = card ? b.pure.sortedList(card.upgrades) : [];
  const picks = T.upgrades.map((raw) => { const u = splitUp(raw), e = catEntry(d, u.name); return { key: e?.key ?? "custom", name: e?.name ?? u.name, power: u.power, status: "active", count: 1 }; });
  return { card, owned: [...base, ...picks] };
}
function upgradeState(ctx, T, mode, entry, power) {
  const b = bapi();
  if (!b || !entry) return { ok: null, unmet: [], stack: { ok: true } };
  const { card, owned } = ownedFor(ctx, T, mode);
  const s = ctx.state;
  const hero = { id: ctx.actor.id, name: s.heroName || ctx.actor.name, resources: Number(s.resources) || 0, occupation: String(s.occupation ?? "") };
  const others = card ? b.memberFacts(card.id).filter((m) => m.id !== ctx.actor.id) : [];
  const ev = b.pure.evalPrerequisite(entry.prereq, { members: [hero, ...others], owned });
  const stack = b.pure.checkStack(entry, owned.filter((u) => u.key === entry.key), { power: power ?? "" });
  const unmet = (ev.reasons ?? []).filter((r) => /Unmet$|Unknown$/.test(r.key)).map((r) => b.t(r.key, r.params));
  return { ok: ev.ok, unmet, stack, tooPricey: ev.tooPricey };
}
/** a player cannot start with an upgrade whose prerequisite is unmet in a base card (ops.mjs refuses it); text mode and the GM are free */
const blocksPlayer = (mode, st) => (mode === "join" || mode === "create") && st.ok === false && !(bapi()?.isStaff?.());

/* ---------------------------------------------------------------- pieces */
function status(ctx) {
  const iss = validateStep(ctx.state, "team");
  if (!iss.issues.length) return `<p class="ipc-status ipc-ok" data-status>${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Step.StatusOk"))}</p>`;
  const cls = (i) => (i.severity === "error" ? "ipc-iss-err" : i.severity === "info" ? "ipc-iss-info" : "ipc-iss-warn");
  return `<ul class="ipc-status-list" data-status>${iss.issues.map((i) => `<li class="${cls(i)}">${icon("fa-solid fa-circle-exclamation")}<span>${esc(msgText(i))}</span></li>`).join("")}</ul>`;
}
const msgLine = (d, key) => `<p class="ipc-pw-msg" role="status" data-msg="${key}">${d.msgFor === key && d.msg ? `${icon("fa-solid fa-circle-info")} ${esc(d.msg)}` : ""}</p>`;
const diceBtn = (act, label, tip) => `<button type="button" class="ipc-btn ipc-btn-small" data-act="${act}" data-fk="${act}" data-tooltip="${esc(tip)}">${icon("fa-solid fa-dice")} ${esc(label)}</button>`;
const tog = (label, on, attrs, aria) => `<button type="button" class="ipc-btn ipc-btn-small ipc-tog${on ? " is-on" : ""}" aria-pressed="${on}" ${attrs}${aria ? ` aria-label="${esc(aria)}"` : ""}>${icon(on ? "fa-solid fa-check" : "fa-solid fa-plus")} ${esc(label)}</button>`;
const die = (n) => `<span class="ipc-lf-die" aria-hidden="true">${n}</span>`;

/* ---- how the hero is tied to a team */
function modeSection(ctx, T, mode, bases) {
  const b = bapi();
  const opts = [
    { v: "text", name: t("IPC.Team.Mode.Text"), desc: t("IPC.Team.Mode.TextDesc"), why: "" },
    { v: "join", name: t("IPC.Team.Mode.Join"), desc: t("IPC.Team.Mode.JoinDesc"), why: !b ? t("IPC.Team.Mode.NoApi") : !bases.length ? t("IPC.Team.Mode.NoJoin") : "" },
    { v: "create", name: t("IPC.Team.Mode.Create"), desc: t("IPC.Team.Mode.CreateDesc"), why: !b ? t("IPC.Team.Mode.NoApi") : !canCreate() ? t("IPC.Team.Mode.NoCreate") : "" }
  ];
  const html = opts.map((o) => {
    const on = mode === o.v, off = !!o.why && !on;
    return `<label class="ipc-opt${on ? " is-on" : ""}${off ? " is-off" : ""}"><input type="radio" name="team-mode" value="${o.v}" data-fk="team-mode-${o.v}"${on ? " checked" : ""}${off ? " disabled" : ""}>
      <span class="ipc-opt-text"><span class="ipc-opt-name">${esc(o.name)}</span><small>${esc(o.why || o.desc)}</small></span>${icon("fa-solid fa-check ipc-opt-check")}</label>`;
  }).join("");
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tm-h-mode">
    <div class="ipc-cn-head"><h3 id="ipc-tm-h-mode" tabindex="-1">${esc(t("IPC.Team.Mode.Title"))}</h3></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Team.Mode.Sub"))}</p>
    <fieldset class="ipc-opts ipc-tm-modes"><legend class="ipc-sr">${esc(t("IPC.Team.Mode.Legend"))}</legend>${html}</fieldset>
    ${mode === "create" ? `<p class="ipc-muted ipc-pw-hintline">${icon("fa-solid fa-circle-info")} ${esc(t("IPC.Team.Mode.CreateNote"))}</p>` : ""}
  </section>`;
}

/* ---- the hero already belongs to a team base: read-only mirror of the card */
function memberSection(ctx, card) {
  const b = bapi();
  const f = b.sync.format(card.id);
  const note = t("IPC.Team.Member.Note", { team: card.name });
  const ups = b.pure.sortedList(card.upgrades).map((u) => b.pure.formatUpgrade(u)).join(", ");
  const ro = (id, label, val) => `<label class="ipc-field"><span>${esc(label)}</span><input type="text" class="ipc-input ipc-tm-ro" id="${id}" value="${esc(val)}" readonly aria-readonly="true" aria-describedby="ipc-tm-lock" data-fk="${id}"></label>`;
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tm-h-member">
    <div class="ipc-cn-head"><h3 id="ipc-tm-h-member" tabindex="-1">${esc(t("IPC.Team.Member.Title"))}</h3>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="open-card" data-fk="open-card">${icon("fa-solid fa-people-roof")} ${esc(t("IPC.Team.Member.Open"))}</button></div>
    <p class="ipc-tm-lock" id="ipc-tm-lock">${icon("fa-solid fa-lock")} <span>${esc(note)}</span></p>
    <div class="ipc-tm-ro-grid">
      ${ro("ipc-tm-ro-team", t("IPC.Team.Name.Label"), f.team)}
      ${ro("ipc-tm-ro-base", t("IPC.Team.Member.BaseLabel"), f.teamBase)}
    </div>
    <p class="ipc-muted ipc-pw-hintline">${esc(ups ? t("IPC.Team.Member.Upgrades", { list: ups }) : t("IPC.Team.Member.NoUpgrades"))}</p>
  </section>`;
}

/* ---- JOIN: the list of bases */
function joinSection(ctx, T, bases) {
  const b = bapi(), d = ctx.data;
  const chosen = T.baseId ? b?.get(T.baseId) : null;
  const gone = !!T.baseId && !chosen;
  const rows = bases.map((v, i) => {
    const on = v.id === T.baseId;
    const where = [v.base?.kind, v.base?.where].filter(Boolean).join(", ");
    const n = b.members(v.id, { all: true }).length;
    return `<li class="ipc-pw-row${on ? " is-added" : ""}${d.landed === `b:${v.id}` ? " ipc-landed" : ""}">
      <div class="ipc-pw-row-main"><div class="ipc-pw-row-head"><span class="ipc-pw-name">${esc(v.name)}</span><span class="ipc-pw-badge">${icon("fa-solid fa-ranking-star")} ${esc(RANKS[v.rank] ? rankName(v.rank) : "?")}</span></div>
        <p class="ipc-pw-desc">${esc(where || t("IPC.Team.Join.NoPlace"))} · ${esc(t("IPC.Team.Join.Facts", { members: n, upgrades: countOf(v.upgrades) }))}</p></div>
      <button type="button" class="ipc-btn ipc-btn-small${on ? "" : " ipc-btn-primary"}" data-act="pick-base" data-id="${esc(v.id)}" data-fk="base-${i}" aria-pressed="${on}" aria-label="${esc(t("IPC.Team.Join.PickAria", { name: v.name }))}">${icon(on ? "fa-solid fa-check" : "fa-solid fa-plus")} ${esc(t(on ? "IPC.Team.Join.Chosen" : "IPC.Team.Join.Pick"))}</button>
    </li>`;
  }).join("");
  const sel = chosen ? `<p class="ipc-note-box ipc-tm-sel" role="status">${icon("fa-solid fa-link")} ${esc(t("IPC.Team.Join.Selected", { name: chosen.name }))}</p>` : "";
  const warn = gone ? `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Team.Join.Gone"))}</p>` : "";
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tm-h-join">
    <div class="ipc-cn-head"><h3 id="ipc-tm-h-join" tabindex="-1">${esc(t("IPC.Team.Join.Title"))}</h3></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Team.Join.Sub"))}</p>
    ${warn}${sel}
    <ul class="ipc-pw-rows" data-list="bases">${rows}</ul>
  </section>`;
}

/* ---- text / create: team name + base kind + location */
function nameSection(ctx, T) {
  const d = ctx.data;
  const chips = d.names.map((e, i) => `${die(i + 1)}${tog(e.name, nm(T.name) === nm(e.name), `data-act="use-name" data-i="${i}" data-fk="tname-${i}"`)}`).join("");
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tm-h-name">
    <div class="ipc-cn-head"><h3 id="ipc-tm-h-name" tabindex="-1">${esc(t("IPC.Team.Name.Title"))}</h3>${d.names.length ? diceBtn("roll-name", t("IPC.Team.Name.Roll"), t("IPC.Team.Name.RollTip", { n: d.names.length })) : ""}</div>
    <p class="ipc-cn-sub">${esc(t("IPC.Team.Name.Sub"))}</p>
    ${msgLine(d, "name")}
    <label class="ipc-field"><span>${esc(t("IPC.Team.Name.Label"))}</span><input type="text" class="ipc-input" name="team-name" data-save="teamName" data-fk="team-name" maxlength="80" autocomplete="off" value="${esc(T.name)}"></label>
    ${d.names.length ? `<div class="ipc-ps-chips" role="group" aria-label="${esc(t("IPC.Team.Name.ChipsAria"))}">${chips}</div>` : ""}
  </section>`;
}
function baseSection(ctx, T) {
  const d = ctx.data, kinds = d.kinds[ctx.state.rank] ?? [];
  const chips = kinds.map((e, i) => tog(e.name, nm(T.base) === nm(e.name), `data-act="use-kind" data-i="${i}" data-fk="kind-${i}"`)).join("");
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tm-h-base">
    <div class="ipc-cn-head"><h3 id="ipc-tm-h-base" tabindex="-1">${esc(t("IPC.Team.Base.Title"))}</h3></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Team.Base.Sub", { rank: rankName(ctx.state.rank) }))}</p>
    ${msgLine(d, "base")}
    <div class="ipc-ps-name">
      <label class="ipc-field"><span>${esc(t("IPC.Team.Base.Kind"))}</span><input type="text" class="ipc-input" name="team-base" data-save="teamBase" data-fk="team-base" maxlength="120" autocomplete="off" value="${esc(T.base)}" placeholder="${esc(t("IPC.Team.Base.KindPh"))}"></label>
      ${kinds.length ? diceBtn("roll-kind", t("IPC.Team.Base.KindRoll"), t("IPC.Team.Base.KindRollTip", { rank: rankName(ctx.state.rank) })) : ""}
    </div>
    ${kinds.length ? `<div class="ipc-ps-chips" role="group" aria-label="${esc(t("IPC.Team.Base.ChipsAria", { rank: rankName(ctx.state.rank) }))}">${chips}</div>` : `<p class="ipc-muted ipc-pw-hintline">${esc(t("IPC.Team.Base.NoKinds"))}</p>`}
    <div class="ipc-ps-name">
      <label class="ipc-field"><span>${esc(t("IPC.Team.Base.Where"))}</span><input type="text" class="ipc-input" name="team-where" data-save="teamWhere" data-fk="team-where" maxlength="120" autocomplete="off" value="${esc(T.where)}" placeholder="${esc(t("IPC.Team.Base.WherePh"))}"></label>
      ${d.city?.length ? diceBtn("roll-where", t("IPC.Team.Base.WhereRoll"), t("IPC.Team.Base.WhereRollTip")) : ""}
    </div>
    ${d.city?.length ? "" : `<p class="ipc-muted ipc-pw-hintline">${esc(t("IPC.Team.Base.NoCity"))}</p>`}
  </section>`;
}

/* ---- starting upgrades */
function meter(ctx, T, mode) {
  const a = allowanceOf(ctx, T, mode);
  const used = a.used + a.picks, cells = Math.max(a.total, used, 1);
  const cellHtml = Array.from({ length: cells }, (_, i) => `<i class="ipc-pw-cell${i < used ? " is-used" : ""}${i >= a.total ? " is-extra" : ""}"></i>`).join("");
  const over = used > a.total;
  const line = a.total === 0 ? t("IPC.Team.Up.Zero", { rank: rankName(a.rank) })
    : over ? t("IPC.Team.Up.Over", { n: used - a.total, rank: rankName(a.rank) })
    : a.left === 0 ? t("IPC.Team.Up.Done") : t("IPC.Team.Up.Left", { n: a.left, rank: rankName(a.rank) });
  const sub = mode === "join" ? t("IPC.Team.Up.Joined", { used: a.used, total: a.total, rank: rankName(a.rank) }) : t("IPC.Team.Up.RankNote", { rank: rankName(a.rank), total: a.total });
  return `<div class="ipc-pw-meter ipc-tm-meter${over ? " is-over" : ""}" role="group" aria-label="${esc(t("IPC.Team.Up.MeterLabel"))}">
    <div class="ipc-pw-m-slots"><b>${used}</b><span>${esc(t("IPC.Team.Up.Of", { max: a.total }))}</span><span class="ipc-pw-cells" aria-hidden="true">${cellHtml}</span></div>
    <div class="ipc-pw-m-text"><p><strong>${esc(line)}</strong></p><p class="ipc-muted">${esc(sub)}</p><p class="ipc-pw-msg" role="status" data-msg="up">${ctx.data.msgFor === "up" && ctx.data.msg ? `${icon("fa-solid fa-circle-info")} ${esc(ctx.data.msg)}` : ""}</p></div>
  </div>`;
}
function upgradeRows(ctx, T, mode) {
  const d = ctx.data, a = allowanceOf(ctx, T, mode);
  return d.cat.map((e, i) => {
    const power = d.pw[e.key] ?? "";
    const st = upgradeState(ctx, T, mode, e, power);
    const picked = T.upgrades.filter((r) => nm(splitUp(r).name) === nm(e.name)).length;
    const reasons = [];
    if (st.stack && !st.stack.ok) reasons.push(t("IPC.Team.Up.Limit"));
    else if (a.left <= 0) reasons.push(t("IPC.Team.Up.NoneLeft"));
    if (blocksPlayer(mode, st)) reasons.push(t("IPC.Team.Up.Needs", { why: st.unmet.join("; ") || t("IPC.Team.Up.PrereqUnmet") }));
    const off = reasons.length > 0;
    const prereqBadge = st.ok === false && !blocksPlayer(mode, st) ? `<span class="ipc-pw-badge ipc-tm-warn">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Team.Up.PrereqUnmet"))}</span>` : st.ok === true && e.prereqRaw && !/^[-–—\s]*$/.test(e.prereqRaw) ? `<span class="ipc-pw-badge ipc-tm-met">${icon("fa-solid fa-check")} ${esc(t("IPC.Team.Up.PrereqMet"))}</span>` : "";
    return `<li class="ipc-pw-row${picked ? " is-added" : ""}">
      <div class="ipc-pw-row-main"><div class="ipc-pw-row-head"><span class="ipc-pw-name">${esc(e.name)}</span>${picked ? `<span class="ipc-pw-badge">${icon("fa-solid fa-check")} ${esc(t("IPC.Team.Up.Picked", { n: picked }))}</span>` : ""}${prereqBadge}</div>
        <p class="ipc-pw-desc">${esc(e.effect || "")}</p>
        ${e.prereqRaw && !/^[-–—\s]*$/.test(e.prereqRaw) ? `<p class="ipc-muted ipc-pw-hintline">${esc(t("IPC.Team.Up.Prereq", { text: e.prereqRaw }))}</p>` : ""}
        ${e.perPower ? `<label class="ipc-field ipc-tm-power"><span>${esc(t("IPC.Team.Up.PowerLabel"))}</span><input type="text" class="ipc-input" name="up-power-${esc(e.key)}" data-uppower="${esc(e.key)}" data-fk="up-power-${esc(e.key)}" maxlength="40" autocomplete="off" value="${esc(power)}"></label>` : ""}
        ${off ? `<p class="ipc-muted ipc-pw-hintline ipc-tm-why" id="ipc-tm-why-${i}">${icon("fa-solid fa-ban")} ${esc(reasons.join(" "))}</p>` : ""}</div>
      <button type="button" class="ipc-btn ipc-btn-small${off ? "" : " ipc-btn-primary"}" data-act="add-up" data-key="${esc(e.key)}" data-fk="up-${i}"${off ? ` aria-disabled="true" aria-describedby="ipc-tm-why-${i}"` : ""} aria-label="${esc(t("IPC.Team.Up.AddAria", { name: e.name }))}">${icon("fa-solid fa-plus")} ${esc(t("IPC.Team.Up.Add"))}</button>
    </li>`;
  }).join("");
}
function upgradesSection(ctx, T, mode) {
  const d = ctx.data;
  const chosen = T.upgrades.length
    ? `<ul class="ipc-chips" aria-label="${esc(t("IPC.Team.Up.ChosenAria"))}">${T.upgrades.map((u, i) => chip(esc(u), t("IPC.Team.Up.RemoveAria", { name: u }), "rm-up", `data-i="${i}" data-fk="rmu-${i}"`)).join("")}</ul>`
    : `<p class="ipc-muted ipc-pw-none">${esc(t("IPC.Team.Up.None"))}</p>`;
  const rec = d.rec.map((n) => catEntry(d, n)).filter(Boolean);
  const recHtml = rec.length ? `<div class="ipc-tm-rec"><span class="ipc-muted">${esc(t("IPC.Team.Up.Recommended"))}</span> ${rec.map((e, i) => tog(e.name, T.upgrades.some((u) => nm(splitUp(u).name) === nm(e.name)), `data-act="add-up" data-key="${esc(e.key)}" data-fk="rec-${i}"`, t("IPC.Team.Up.AddAria", { name: e.name }))).join("")}</div>` : "";
  const rows = d.cat.length
    ? `<ul class="ipc-pw-rows" data-list="ups">${upgradeRows(ctx, T, mode)}</ul>`
    : `<p class="ipc-note-box">${icon("fa-solid fa-circle-info")} ${esc(t("IPC.Team.Up.NoCatalog"))}</p>`;
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tm-h-up">
    <div class="ipc-cn-head"><h3 id="ipc-tm-h-up" tabindex="-1">${esc(t("IPC.Team.Up.Title"))}</h3></div>
    <p class="ipc-cn-sub">${esc(t(mode === "join" ? "IPC.Team.Up.SubJoin" : "IPC.Team.Up.Sub"))}</p>
    ${meter(ctx, T, mode)}
    <h4 class="ipc-tm-h4">${esc(t("IPC.Team.Up.Chosen"))}</h4>${chosen}
    ${recHtml}
    <div class="ipc-pw-custom">
      <label class="ipc-field"><span>${esc(t("IPC.Team.Up.Custom"))}</span><input type="text" class="ipc-input" name="up-custom" data-fk="up-custom" maxlength="60" autocomplete="off" placeholder="${esc(t("IPC.Team.Up.CustomPh"))}"></label>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="add-custom" data-fk="add-custom">${icon("fa-solid fa-plus")} ${esc(t("IPC.Team.Up.CustomAdd"))}</button>
    </div>
    ${rows}
  </section>`;
}

/* ---- second key relationship with another hero */
function relSection(ctx) {
  const d = ctx.data, s = ctx.state, cur = s.heroRel?.name ?? "";
  const rows = d.heroes.map((e, i) => {
    const on = !!cur && (s.heroRel?.actorUuid ? s.heroRel.actorUuid === e.packUuid : nm(cur) === nm(e.name));
    return `<li class="ipc-pw-row${on ? " is-added" : ""}${d.landed === `h:${i}` ? " ipc-landed" : ""}">
      <div class="ipc-pw-row-main"><div class="ipc-pw-row-head"><span class="ipc-pw-name">${esc(e.name)}</span></div></div>
      <button type="button" class="ipc-btn ipc-btn-small${on ? "" : " ipc-btn-primary"}" data-act="pick-hero" data-i="${i}" data-fk="hero-${i}" aria-pressed="${on}" aria-label="${esc(t("IPC.Team.Rel.PickAria", { name: e.name }))}">${icon(on ? "fa-solid fa-check" : "fa-solid fa-plus")} ${esc(t(on ? "IPC.Team.Rel.Chosen" : "IPC.Team.Rel.Pick"))}</button>
    </li>`;
  }).join("");
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tm-h-rel">
    <div class="ipc-cn-head"><h3 id="ipc-tm-h-rel" tabindex="-1">${esc(t("IPC.Team.Rel.Title"))}</h3>${d.heroes.length ? diceBtn("roll-hero", t("IPC.Team.Rel.Roll"), t("IPC.Team.Rel.RollTip", { n: d.heroes.length })) : ""}</div>
    <p class="ipc-cn-sub">${esc(t("IPC.Team.Rel.Sub"))}</p>
    ${msgLine(d, "rel")}
    ${d.heroes.length ? `<ul class="ipc-pw-rows" data-list="heroes">${rows}</ul>` : `<p class="ipc-note-box ipc-pw-empty">${icon("fa-solid fa-user-group")} ${esc(t("IPC.Team.Rel.Empty"))}</p>`}
    <div class="ipc-ps-name">
      <label class="ipc-field"><span>${esc(t("IPC.Team.Rel.Label"))}</span><input type="text" class="ipc-input" name="hero-rel" data-save="heroRel" data-fk="hero-rel" maxlength="60" autocomplete="off" value="${esc(cur)}"></label>
      ${cur ? `<button type="button" class="ipc-btn ipc-btn-small" data-act="clear-hero" data-fk="clear-hero">${icon("fa-solid fa-xmark")} ${esc(t("IPC.Team.Rel.Clear"))}</button>` : ""}
    </div>
    <p class="ipc-muted ipc-pw-hintline">${esc(cur ? t("IPC.Team.Rel.Line", { name: cur }) : t("IPC.Team.Rel.Hint"))}</p>
  </section>`;
}

/* ---------------------------------------------------------------- data loading + dice */
async function loadCity(ctx) {
  const d = ctx.data, b = bapi();
  d.city = null;
  try {
    const tb = b ? await b.catalog.cityTable() : null;
    if (tb) d.city = [...tb.results].map((r) => ({ lo: r.range?.[0] ?? 0, hi: r.range?.[1] ?? 0, name: plain(r.description || r.name).short || String(r.name ?? "") })).filter((r) => r.name);
  } catch (err) { console.warn(`${MOD} | chargen: City Locations unavailable`, err); }
}
/** the creation-table list of sample bases for the current rank (re-read when the rank changed since the step was loaded) */
async function ensureKinds(ctx) {
  const d = ctx.data, rank = ctx.state.rank;
  if (d.kinds[rank]) return false;
  d.kinds[rank] = [];
  try { d.kinds[rank] = await ctx.provider().list("teamBases", { rank }); } catch (err) { console.warn(`${MOD} | chargen: team base list failed`, err); }
  return true;
}
const said = (ctx, key, text) => { ctx.data.msgFor = key; ctx.data.msg = text; };
function setTeam(ctx, patch, o = {}) { ctx.update((st) => ({ ...st, team: { ...teamOf(st), ...patch } }), o); }
function nextFree(list, start, ok) { for (let i = 0; i < list.length; i++) { const e = list[(start + i) % list.length]; if (ok(e)) return e; } return null; }

function rollFrom(ctx, counter, list, current, field, msgKey) {
  if (!list.length) return;
  const s = ctx.state, n = s.rerolls?.[counter] ?? 0;
  const idx = substream(s.seed, `${counter}:${n}`).int(list.length);
  const e = nextFree(list, idx, (x) => nm(x.name) !== nm(current)) ?? list[idx];
  said(ctx, msgKey, list.length <= 10 ? t("IPC.Life.Rolled", { die: list.indexOf(e) + 1, name: e.name }) : t("IPC.Life.RolledPlain", { name: e.name }));
  ctx.data.landed = null;
  ctx.update((st) => ({ ...st, team: { ...teamOf(st), [field]: e.name }, rerolls: { ...st.rerolls, [counter]: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Team.Rolled", { name: e.name }));
}
function rollWhere(ctx) {
  const d = ctx.data, s = ctx.state;
  if (!d.city?.length) return;
  const n = s.rerolls?.teamWhere ?? 0;
  const roll = substream(s.seed, `teamWhere:${n}`).d66();                               // the book table is a D66 with uneven rows: roll its own die
  const e = d.city.find((r) => roll >= r.lo && roll <= r.hi) ?? d.city[0];
  said(ctx, "base", t("IPC.Team.Base.WhereRolled", { roll, name: e.name }));
  ctx.update((st) => ({ ...st, team: { ...teamOf(st), where: e.name }, rerolls: { ...st.rerolls, teamWhere: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Team.Rolled", { name: e.name }));
}
function rollHero(ctx) {
  const d = ctx.data, s = ctx.state;
  if (!d.heroes.length) return;
  const n = s.rerolls?.heroRel ?? 0;
  const idx = substream(s.seed, `heroRel:${n}`).int(d.heroes.length);
  const e = nextFree(d.heroes, idx, (x) => nm(x.name) !== nm(s.heroRel?.name)) ?? d.heroes[idx];
  d.landed = `h:${d.heroes.indexOf(e)}`;
  said(ctx, "rel", t("IPC.Team.Rel.Rolled", { name: e.name }));
  ctx.update((st) => ({ ...st, heroRel: { name: e.name, actorUuid: e.packUuid ?? e.data?.actorUuid ?? null }, rerolls: { ...st.rerolls, heroRel: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Team.Rolled", { name: e.name }));
}

function addUpgrade(ctx, name, power = "") {
  const s = ctx.state, T = teamOf(s), d = ctx.data;
  const mode = effMode(T, liveCard(ctx));
  const nameClean = clean(name);
  if (!nameClean) return;
  const e = catEntry(d, nameClean);
  const a = allowanceOf(ctx, T, mode);
  if (a.left <= 0) { said(ctx, "up", t("IPC.Team.Up.NoneLeft")); ctx.rerender(); return; }
  if (e?.perPower && !clean(power)) { said(ctx, "up", t("IPC.Team.Up.PowerNeeded")); ctx.rerender(); requestAnimationFrame(() => ctx.app.focusBody(`[data-fk="up-power-${e.key}"]`)); return; }
  if (e) {
    const st = upgradeState(ctx, T, mode, e, clean(power));
    if (!st.stack.ok) { said(ctx, "up", t("IPC.Team.Up.Limit")); ctx.rerender(); return; }
    if (blocksPlayer(mode, st)) { said(ctx, "up", t("IPC.Team.Up.Needs", { why: st.unmet.join("; ") || t("IPC.Team.Up.PrereqUnmet") })); ctx.rerender(); return; }
  }
  const full = joinUp(e?.name ?? nameClean, e?.perPower ? clean(power) : "");
  d.msgFor = ""; d.msg = "";
  setTeam(ctx, { upgrades: [...T.upgrades, full] }, { body: true });
  ctx.announce(t("IPC.Team.Up.Added", { name: full }));
}

/* ---------------------------------------------------------------- the step */
export default {
  id: "team",
  icon: "fa-solid fa-people-group",

  async load(ctx) {
    const d = ctx.data, P = ctx.provider(), b = bapi();
    Object.assign(d, { names: [], heroes: [], cat: [], rec: [], kinds: {}, city: null, pw: {}, msg: "", msgFor: "", landed: null });
    const safe = (p) => p.catch((err) => { console.warn(`${MOD} | chargen: team step list failed`, err); return []; });
    [d.names, d.heroes] = await Promise.all([safe(P.list("teamNames", {})), safe(P.list("heroRelations", {}))]);
    if (b) {
      [d.cat, d.rec] = await Promise.all([safe(Promise.resolve(b.catalog.upgrades())), safe(Promise.resolve(b.catalog.recommendedUpgrades()))]);
      await loadCity(ctx);
    }
    await ensureKinds(ctx);
  },

  render(ctx) {
    const T = teamOf(ctx.state), card = liveCard(ctx), mode = effMode(T, card);
    const bases = visibleBases();
    const parts = [status(ctx)];
    if (mode === "member") parts.push(memberSection(ctx, card));
    else {
      parts.push(modeSection(ctx, T, mode, bases));
      if (mode === "join") parts.push(joinSection(ctx, T, bases));
      else parts.push(nameSection(ctx, T), baseSection(ctx, T));
      if (mode !== "join" || T.baseId) parts.push(upgradesSection(ctx, T, mode));
    }
    parts.push(relSection(ctx));
    return `<div class="ipc-powers ipc-team">${parts.join("")}</div>`;
  },

  mount(ctx, root) {
    const d = ctx.data;
    ensureKinds(ctx).then((changed) => { if (changed && root.isConnected) ctx.rerender(); });
    if (d.landed) { requestAnimationFrame(() => root.querySelector(".ipc-landed")?.scrollIntoView({ block: "nearest" })); d.landed = null; }

    const saver = bindAutosave(root, ctx, {
      apply(key) {
        const val = (name) => clean(root.querySelector(`[name="${name}"]`)?.value ?? "");
        if (key === "teamName") setTeam(ctx, { name: val("team-name") }, { coalesce: "teamName" });
        else if (key === "teamBase") setTeam(ctx, { base: val("team-base") }, { coalesce: "teamBase" });
        else if (key === "teamWhere") setTeam(ctx, { where: val("team-where") }, { coalesce: "teamWhere" });
        else if (key === "heroRel") {
          const v = val("hero-rel");
          ctx.update((st) => ({ ...st, heroRel: { name: v, actorUuid: v && nm(v) === nm(st.heroRel?.name) ? st.heroRel?.actorUuid ?? null : null } }), { coalesce: "heroRel" });
        }
      },
      after() { const st = root.querySelector("[data-status]"); if (st) st.outerHTML = status(ctx); }
    });

    root.addEventListener("input", (ev) => {
      const el = ev.target;
      if (el instanceof HTMLInputElement && el.dataset.uppower) d.pw[el.dataset.uppower] = el.value;
    });
    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.name === "up-custom") { ev.preventDefault(); addUpgrade(ctx, ev.target.value); }
    });
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLInputElement) || el.type !== "radio" || el.name !== "team-mode") return;
      saver.flush();
      const v = el.value;
      if (v !== teamOf(ctx.state).mode) { d.msgFor = ""; d.msg = ""; setTeam(ctx, { mode: v }, { body: true }); ctx.announce(t(`IPC.Team.Mode.Set.${v}`)); }
    });

    delegate(root, "click", "[data-act]", (ev, el) => {
      if (el.getAttribute("aria-disabled") === "true") {
        const why = root.querySelector(`#${el.getAttribute("aria-describedby")}`)?.textContent;
        if (why) { ctx.announce(why.trim()); }
        return;
      }
      saver.flush();
      const act = el.dataset.act, s = ctx.state, T = teamOf(s);
      switch (act) {
        case "roll-name": rollFrom(ctx, "teamName", d.names, T.name, "name", "name"); break;
        case "roll-kind": rollFrom(ctx, "teamKind", d.kinds[s.rank] ?? [], T.base, "base", "base"); break;
        case "roll-where": rollWhere(ctx); break;
        case "roll-hero": rollHero(ctx); break;
        case "use-name": { const e = d.names[Number(el.dataset.i)]; if (e) { d.msgFor = ""; d.msg = ""; setTeam(ctx, { name: e.name }, { body: true }); ctx.announce(t("IPC.Team.Rolled", { name: e.name })); } break; }
        case "use-kind": { const e = (d.kinds[s.rank] ?? [])[Number(el.dataset.i)]; if (e) { d.msgFor = ""; d.msg = ""; setTeam(ctx, { base: e.name }, { body: true }); ctx.announce(t("IPC.Team.Rolled", { name: e.name })); } break; }
        case "pick-base": {
          const id = el.dataset.id;
          d.landed = `b:${id}`; d.msgFor = ""; d.msg = "";
          setTeam(ctx, { baseId: id === T.baseId ? null : id, upgrades: id === T.baseId ? T.upgrades : [] }, { body: true });
          break;
        }
        case "add-up": { const e = d.cat.find((u) => u.key === el.dataset.key); if (e) addUpgrade(ctx, e.name, d.pw[e.key] ?? ""); break; }
        case "add-custom": addUpgrade(ctx, root.querySelector('[name="up-custom"]')?.value ?? ""); break;
        case "rm-up": {
          const i = Number(el.dataset.i), name = T.upgrades[i];
          if (name === undefined) break;
          d.msgFor = ""; d.msg = "";
          setTeam(ctx, { upgrades: T.upgrades.filter((_, j) => j !== i) }, { body: true });
          ctx.announce(t("IPC.Team.Up.Removed", { name }));
          break;
        }
        case "pick-hero": {
          const e = d.heroes[Number(el.dataset.i)];
          if (!e) break;
          d.landed = `h:${el.dataset.i}`; d.msgFor = ""; d.msg = "";
          ctx.update((st) => ({ ...st, heroRel: { name: e.name, actorUuid: e.packUuid ?? e.data?.actorUuid ?? null } }), { body: true });
          ctx.announce(t("IPC.Team.Rolled", { name: e.name }));
          break;
        }
        case "clear-hero": d.msgFor = ""; d.msg = ""; ctx.update((st) => ({ ...st, heroRel: { name: "", actorUuid: null } }), { body: true }); break;
        case "open-card": { const b = bapi(); try { b?.open(ctx.actor); } catch (err) { console.warn(`${MOD} | chargen: cannot open the team card`, err); } break; }
        default: break;
      }
    });
  },

  onState(ctx) {
    const d = ctx.data;
    if (!d.names) return;
    d.msg = ""; d.msgFor = ""; d.landed = null;
  }
};
