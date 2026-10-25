// Team & Base card, phase B6: PURE helpers of the Upgrades tab (tabs/upgrades.mjs). NO Foundry globals: runs in Node and in the browser (checked by check-up.mjs).
// They compose pure.mjs (prerequisites, stacking, cost, allowance, karma split) into what the tab shows and which buttons are allowed. Messages are KEYS + params.
import * as P from "./pure.mjs";

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const lc = (s) => String(s ?? "").trim().toLowerCase();

/** What the tab shows as the status of an owned upgrade: while the base is occupied every upgrade counts as lost (book: adversaries take over, all upgrades lost). */
export function shownStatus(u, occupied = false) {
  if (occupied) return "lost";
  return P.STATUSES.includes(u?.status) ? u.status : "active";
}

/** Number of upgrades owned (sum of the stack counts). */
export const ownedCount = (list) => (Array.isArray(list) ? list : Object.values(list || {})).reduce((n, u) => n + Math.max(1, num(u?.count, 1)), 0);

/**
 * Everything the catalog row needs: the prerequisite evaluation against the team, the stack state, the price and which buttons are allowed (with the reason key when not).
 *   entry   catalog entry { key, name, prereq, max, perPower, ... } | { key: "custom" } for a custom upgrade (no prerequisite, no limit)
 *   ctx     { members:[{id,name,resources,occupation,karma}], owned:[upgrade rows], power, staff, left (starting picks left), canEdit }
 * Returns { state: "met"|"tooPricey"|"blocked"|"unknown"|"maxed", ev, stack, cost:{cost,kind,blocked}, needPower,
 *           start:{ok,why}, buy:{ok,why}, grant:{ok,why} }   why = { key, params } | null
 */
export function catalogState(entry, ctx) {
  ctx = ctx && typeof ctx === "object" ? ctx : {};
  const members = ctx.members || [], owned = ctx.owned || [];
  const power = String(ctx.power ?? "").trim();
  const custom = !entry || entry.key === "custom" || !entry.prereq;
  const ev = custom ? { ok: true, tooPricey: false, reasons: [] } : P.evalPrerequisite(entry.prereq, { members, owned });
  const same = custom ? [] : owned.filter((u) => u.key === entry.key);
  const stack = custom ? { ok: true, count: 0, max: null } : P.checkStack(entry, same, { power });
  const cost = P.upgradeCost(ev.ok === null ? { ok: null } : ev);
  const needPower = !!entry?.perPower && !power;
  let state = ev.ok === null ? "unknown" : ev.ok ? "met" : ev.tooPricey ? "tooPricey" : "blocked";
  if (!stack.ok) state = "maxed";
  const why = (key, params = {}) => ({ key, params });
  const none = { ok: true, why: null };
  const gate = needPower ? why("IPB.Up.needPower") : !stack.ok ? stack.reason : null;
  // starting upgrade: free while the allowance lasts. B11 (A15a, user decision): the book allows ANY starting upgrades, so an unmet prerequisite does not block a
  // starting pick for anyone (P.START_IGNORES_PREREQ switches the old "players must meet it" rule back on; ops.upgrades.add reads the same constant)
  let start = none;
  if (!ctx.canEdit) start = { ok: false, why: why("IPB.Up.readOnly") };
  else if (gate) start = { ok: false, why: gate };
  else if (!(num(ctx.left) > 0)) start = { ok: false, why: why("IPB.Up.noAllowance") };
  else if (!ctx.staff && ev.ok === false && !P.START_IGNORES_PREREQ) start = { ok: false, why: why(state === "tooPricey" ? "IPB.Up.startTooPricey" : "IPB.Up.startNeedsPre") };
  // buy with karma: blocked when an upgrade prerequisite is missing; Too Pricey doubles the price
  let buy = none;
  if (!ctx.canEdit) buy = { ok: false, why: why("IPB.Up.readOnly") };
  else if (gate) buy = { ok: false, why: gate };
  else if (cost.blocked) buy = { ok: false, why: why("IPB.Up.blocked") };
  // grant (staff): ignores limits, but a power must be named for Power Effect
  let grant = ctx.staff ? none : { ok: false, why: why("IPB.Up.staffOnly") };
  if (ctx.staff && needPower) grant = { ok: false, why: why("IPB.Up.needPower") };
  return { state, ev, stack, cost, needPower, start, buy, grant };
}

/** Upgrades named in hero texts that the card does not (fully) have. parsed = [{key,name,count,power}] (P.parseTeamBase(...).upgrades), owned = card rows.
    Returns the missing part: [{key,name,count,power}] with count = how many copies are missing. */
export function missingFromText(parsed, owned) {
  const out = [];
  owned = Array.isArray(owned) ? owned : [];
  for (const p of Array.isArray(parsed) ? parsed : []) {
    const custom = !p.key || p.key === "custom";
    const have = owned.filter((u) => (custom ? lc(u.name) === lc(p.name) : u.key === p.key) && lc(u.power) === lc(p.power));
    const n = Math.max(1, num(p.count, 1)) - have.reduce((s, u) => s + Math.max(1, num(u.count, 1)), 0);
    if (n > 0) out.push({ key: custom ? "custom" : p.key, name: p.name, count: n, power: p.power || "" });
  }
  return out;
}
/** Merge the readings of several heroes: one entry per upgrade (key|name + power), the highest count wins (two heroes writing the same list is not two upgrades). */
export function unionAdoptions(lists) {
  const m = new Map();
  for (const l of Array.isArray(lists) ? lists : []) for (const u of Array.isArray(l) ? l : []) {
    if (!u || typeof u !== "object") continue;
    const id = `${u.key === "custom" || !u.key ? `c:${lc(u.name)}` : u.key}|${lc(u.power)}`;
    const cur = m.get(id);
    if (!cur) m.set(id, { key: u.key || "custom", name: u.name, count: Math.max(1, num(u.count, 1)), power: u.power || "" });
    else cur.count = Math.max(cur.count, Math.max(1, num(u.count, 1)));
  }
  return [...m.values()];
}

/** "Tess 6, Rex 4" from a split [{actorId|id, amount, name?}]; names = Map/obj id -> name. Neutral across languages. */
export function formatSplit(split, names = {}) {
  split = Array.isArray(split) ? split : [];
  const get = (id) => (names instanceof Map ? names.get(id) : names?.[id]);
  return split.filter((s) => num(s.amount) > 0).map((s) => `${s.name || get(s.actorId ?? s.id) || "?"} ${s.amount}`).join(", ");
}

/** Karma after a split: [{id, name, before, amount, after}] for every member (amount 0 for those not asked). */
export function previewKarma(members, split) {
  members = Array.isArray(members) ? members : []; split = Array.isArray(split) ? split : [];
  const by = new Map(split.map((s) => [String(s.actorId ?? s.id), num(s.amount)]));
  return members.map((m) => {
    const before = Math.max(0, num(m.karma)), amount = by.get(String(m.id)) ?? 0;
    return { id: m.id, name: m.name, before, amount, after: before - amount };
  });
}

/** Purchase log, newest first: every karma purchase (rows keep `buys` = [{at, paid, kind, split:[{name,amount}]}]; an older karma row without a log gives one line from paid / at). */
export function purchaseLog(upgrades) {
  const list = Array.isArray(upgrades) ? upgrades : P.sortedList(upgrades);
  const out = [];
  for (const u of list) {
    const label = `${u.name}${u.power ? ` (${u.power})` : ""}`;
    if (Array.isArray(u.buys) && u.buys.length) {
      for (const b of u.buys) out.push({ id: u.id, name: label, at: num(b?.at), paid: num(b?.paid), kind: String(b?.kind ?? ""), split: Array.isArray(b?.split) ? b.split : [] });
    } else if (u.source === "karma") out.push({ id: u.id, name: label, at: num(u.at), paid: num(u.paid), kind: "", split: [] });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Training hint (advisory): the winning facility and what a 10 / 20 karma improvement would cost. null when none works. */
export function trainingHint(owned, occupied = false) {
  if (occupied) return null;                       // B11 (A14): while adversaries hold the base every upgrade counts as lost, so no training discount applies
  owned = Array.isArray(owned) ? owned : [];
  const f = P.trainingFactor(owned);
  if (!f) return null;
  return { key: f === 0.2 ? "training-simulator" : "training-facilities", factor: f, ten: P.trainedCost(10, f), twenty: P.trainedCost(20, f) };
}

/** Prerequisite lines of an OWNED upgrade that are about other upgrades (a broken Team Vehicle matters to Vehicle Defense): [{key, params}] of the unmet / disabled ones. */
export function dependencyIssues(entry, owned, selfId = "") {
  if (!entry?.prereq || !entry.prereq.upgrades?.length) return [];
  const others = (Array.isArray(owned) ? owned : []).filter((u) => u.id !== selfId);
  const ev = P.evalPrerequisite({ ...entry.prereq, resources: null, occupations: [] }, { members: [], owned: others });
  return ev.reasons.filter((r) => /preUpgrade(Unmet|Disabled)$/.test(r.key));
}

/** Entries of the recommended list (names from our pack) that exist in the catalog: [{key,name}] (the book's own names, resolved at runtime). */
export function matchRecommended(names, catalog) {
  const out = [];
  catalog = Array.isArray(catalog) ? catalog : [];
  for (const n of Array.isArray(names) ? names : []) {
    const hit = catalog.find((c) => lc(c.name) === lc(n));
    if (hit && !out.some((o) => o.key === hit.key)) out.push({ key: hit.key, name: hit.name });
  }
  return out;
}

/** Filter the catalog by a typed query (name or effect, case-insensitive, all words). */
export function filterCatalog(catalog, query = "") {
  catalog = Array.isArray(catalog) ? catalog : [];
  const words = lc(query).split(/\s+/).filter(Boolean);
  if (!words.length) return catalog.slice();
  return catalog.filter((c) => { const hay = `${lc(c.name)} ${lc(c.effect)} ${lc(c.prereqRaw)}`; return words.every((w) => hay.includes(w)); });
}
