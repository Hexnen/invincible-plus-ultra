/* Team & Base card, phase B7: pure helpers of the Events tab (no Foundry globals, tested by check-ev.mjs, used by ops.mjs AND tabs/events.mjs so the diff
   the GM sees is exactly the change that is written). An event is { at, label, mode, roll, band, effect:{kind, upgrades[], raid, rolled, applied, dismissed,
   prev?, appliedAt?, appliedBy?}, rerolled, resolved, note, by }. */

export const NARRATIVE = ["note", "raid", "aiControl"];          // effects that change nothing on the card (the GM plays them)
export const MECHANICAL = ["disable", "break", "occupy"];         // effects that change upgrade states / the occupied flag
export const PAGE_SIZE = 6;

/** lower bound of a band id ("46-52" -> 46), null when unreadable */
export const bandLow = (band) => { const n = parseInt(String(band ?? ""), 10); return Number.isInteger(n) ? n : null; };

/** none = nothing to decide | pending = proposal waiting | applied | dismissed | rerolled */
export function evState(ev) {
  if (!ev) return "none";
  if (ev.rerolled) return "rerolled";
  const e = ev.effect;
  if (!e || !e.kind || e.kind === "none") return "none";
  if (e.applied) return "applied";
  if (e.dismissed) return "dismissed";
  return "pending";
}
export const isPending = (ev) => evState(ev) === "pending";
export const pendingList = (events) => events.filter(isPending);
export const sumCounts = (upgrades) => Object.values(upgrades ?? {}).reduce((n, u) => n + Math.max(1, Number(u?.count) || 1), 0);

const label = (u) => `${u.name || u.key || "?"}${u.power ? ` (${u.power})` : ""}`;

/** What applying `effect` would do against the CURRENT card B. Never throws; the same function decides the written patch.
    -> { kind, changes:[{uid,name,from,to}], skipped:[{uid,name,why:"gone"|"notActive"|"alreadyBroken"}], occupy, alreadyOccupied, lost } */
export function plan(effect, B) {
  const out = { kind: effect?.kind ?? "none", changes: [], skipped: [], occupy: false, alreadyOccupied: false, lost: 0 };
  if (!effect) return out;
  const ups = B?.upgrades ?? {};
  if (effect.kind === "disable" || effect.kind === "break") {
    for (const uid of effect.upgrades ?? []) {
      const u = ups[uid];
      if (!u) { out.skipped.push({ uid, name: "", why: "gone" }); continue; }
      if (effect.kind === "disable") {
        if (u.status === "active") out.changes.push({ uid, name: label(u), from: u.status, to: "disabled" });
        else out.skipped.push({ uid, name: label(u), why: "notActive", status: u.status });
      } else if (u.status === "broken") out.skipped.push({ uid, name: label(u), why: "alreadyBroken", status: u.status });
      else out.changes.push({ uid, name: label(u), from: u.status, to: "broken" });
    }
  } else if (effect.kind === "occupy") {
    out.alreadyOccupied = !!B?.base?.occupied;
    out.occupy = !out.alreadyOccupied;
    out.lost = sumCounts(ups);
  }
  return out;
}

/** does applying change anything on the card? (a proposal with nothing left to change is still markable as handled) */
export const changesAnything = (p) => p.changes.length > 0 || p.occupy;

/** the card patch (relative to B) of a plan, plus the record needed for one-step undo */
export function patchOf(p) {
  const rel = {}; const statuses = {}; const after = {};
  for (const c of p.changes) { rel[`upgrades.${c.uid}.status`] = c.to; statuses[c.uid] = c.from; after[c.uid] = c.to; }
  const prev = { statuses, after };
  if (p.occupy) { rel["base.occupied"] = true; prev.occupied = false; }
  return { rel, prev };
}

/** The newest applied event can be undone while nothing it changed has been touched since. -> true | false */
export function undoable(ev, events, B) {
  const e = ev?.effect;
  if (!e?.applied || !e.prev || !Number.isFinite(e.appliedAt)) return false;
  for (const o of events) if (o.id !== ev.id && o.effect?.applied && (o.effect.appliedAt ?? 0) > e.appliedAt) return false;
  for (const [uid, to] of Object.entries(e.prev.after ?? {})) { const u = B?.upgrades?.[uid]; if (u && u.status !== to) return false; }
  if (e.prev.occupied === false && !B?.base?.occupied) return false;
  return true;
}

/** relative patch that undoes an applied effect (upgrades that vanished are skipped) */
export function undoPatch(ev, B) {
  const rel = {}; const prev = ev?.effect?.prev;
  if (!prev) return rel;
  for (const [uid, from] of Object.entries(prev.statuses ?? {})) if (B?.upgrades?.[uid]) rel[`upgrades.${uid}.status`] = from;
  if (prev.occupied === false) rel["base.occupied"] = false;
  return rel;
}

/** newest first; `shown` rows of the older history */
export function pageSlice(list, shown, size = PAGE_SIZE) {
  const n = Math.max(size, shown | 0);
  return { rows: list.slice(0, n), more: Math.max(0, list.length - n), next: n + size };
}

/** next "Week N": weekly events that were not re-rolled, plus one */
export function nextWeek(events) {
  return events.filter((e) => e.mode === "week" && !e.rerolled).length + 1;
}

/** valid forced D66 (staff test control): text -> number | null */
export function parseD66(text) {
  const raw = String(text ?? "").trim();
  const n = /^\d{2}$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 11 && n <= 66 && n % 10 >= 1 && n % 10 <= 6 ? n : null;
}
