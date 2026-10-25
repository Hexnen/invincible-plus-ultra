/* Activity log - MAINTENANCE (phase L6), Foundry side: the list of every log of the table (heroes, bases, orphans of deleted actors), the health numbers, trim with a
   preview, delete a log, export per log or all, IMPORT of a previously exported file (single log or bundle), retention overrides. Everything here is STAFF ONLY
   (GM / assistant): each function starts with assertStaff() and throws LogError("noPermission") for anybody else, so a player console call does nothing. Writes are
   plain world document operations (the same ones the scribe uses); none touches an Actor. The pure planning lives in maint-pure.mjs (tested in node). */
import * as E from "./events.mjs";
import * as M from "./model.mjs";
import * as X from "./export.mjs";
import * as MP from "./maint-pure.mjs";
import * as Store from "./store.mjs";
import * as Scribe from "./scribe.mjs";
import * as Relay from "./relay.mjs";

const MOD = E.MOD_ID;
const isStaff = (u) => !!u && (u.isGM === true || u.hasRole?.(CONST.USER_ROLES.ASSISTANT) === true);
export function assertStaff(user = game.user) { if (!isStaff(user)) throw new Relay.LogError("noPermission"); }
const finite = (n, d = 0) => (Number.isFinite(n) ? n : d);
const usersMap = () => Object.fromEntries(game.users.map((u) => [u.id, u.name]));

/* ------------------------------------------------------------------ the list */
/** One row per log: {id, actorId, name, scope, orphan, deletedAt, actor, count, secret, chunks, bytes, first, last, cap, usage, gaps, throttles, unverified, imports, pruned, ...}. */
export function logs() {
  assertStaff();
  return Store.listLogJournals().map((l) => {
    const c = Store.counts(l.actorId);
    const s = MP.summarizeEntries(Store.readEntries(l.actorId, { secret: true }));
    const cap = Store.retention(l.scope);
    return { ...l, count: c.count, secretCount: c.secret, chunks: c.chunks, secretChunks: c.secretChunks, bytes: c.bytes, first: finite(c.first) || s.first, last: finite(c.last) || s.last, cap, usage: MP.usageState(c.count, cap), summary: s };
  }).sort((a, b) => (a.orphan - b.orphan) || a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
}
function find(id) {
  const l = Store.listLogJournals().find((x) => x.actorId === id || x.id === id);
  if (l) return l;
  throw new Relay.LogError("notFound");
}
const actorLike = (l) => l.actor ?? { id: l.actorId, name: l.name, uuid: l.uuid };

/* ------------------------------------------------------------------ health */
export function health() {
  assertStaff();
  const rows = logs();
  const sc = Scribe.summary();
  const active = game.users.activeGM;
  const t = rows.reduce((a, r) => {
    a.entries += r.count; a.secret += r.secretCount; a.bytes += r.bytes; a.chunks += r.chunks + r.secretChunks;
    a.gaps += r.summary.gaps; a.throttles += r.summary.throttles; a.unverified += r.summary.unverified; a.imported += r.summary.importedEntries; a.pruned += r.summary.pruned;
    if (r.orphan) a.orphans++; if (r.usage.state === "over" || r.usage.state === "warn") a.near++;
    return a;
  }, { logs: rows.length, entries: 0, secret: 0, bytes: 0, chunks: 0, gaps: 0, throttles: 0, unverified: 0, imported: 0, pruned: 0, orphans: 0, near: 0 });
  let notLogged = 0;
  for (const a of game.actors) if (Scribe.scopeOf(a) && !Store.actorJournal(a.id)) notLogged++;
  const base = Number(Store.setting("logRetainBase", -1));
  return {
    enabled: Store.enabled(), readAccess: Store.readAccess(), scopeIds: Store.scopeIds(),
    scribe: { activeGm: active?.name ?? null, activeGmId: active?.id ?? null, thisClient: Scribe.isScribe(), on: sc.on, peers: sc.peers, onlineGms: game.users.filter((u) => u.isGM && u.active).map((u) => u.name) },
    retention: { hero: Store.retention("hero"), base: Store.retention("base"), baseOverride: Number.isFinite(base) && base >= 0 ? base : null },
    totals: t, notLogged,
    session: { ...sc.counts, pending: Object.values(sc.open).reduce((n, v) => n + (v || 0), 0), pageUpdates: sc.store.pageUpdates, entriesWritten: sc.store.entriesWritten, skipped: sc.store.skipped, prunes: sc.store.prunes, writeFailures: sc.store.failures },
    queue: Relay.queueInfo()
  };
}

/* ------------------------------------------------------------------ retention overrides */
/** setRetention({hero, base}): hero = number (0 = unlimited); base = number, or null for "automatic (60 percent of the hero cap)". World settings, GM only (Foundry refuses others). */
export async function setRetention({ hero, base } = {}) {
  assertStaff();
  if (hero !== undefined) { const n = MP.parseRetention(hero); if (n === null) throw new Relay.LogError("badInput", { why: "retention" }); await game.settings.set(MOD, "logRetainEntries", n); }
  if (base !== undefined) {
    if (base === null) await game.settings.set(MOD, "logRetainBase", -1);
    else { const n = MP.parseRetention(base); if (n === null) throw new Relay.LogError("badInput", { why: "retention" }); await game.settings.set(MOD, "logRetainBase", n); }
  }
  return { hero: Store.retention("hero"), base: Store.retention("base") };
}

/* ------------------------------------------------------------------ trim */
function pagesFor(l) {
  const j = Store.actorJournal(l.actorId), gm = Store.gmJournal();
  const pages = j ? Store.pagesOf(j) : {};
  const nos = Object.keys(pages).map(Number);
  return { pages, secret: gm ? Store.pagesOf(gm, l.actorId) : null, head: nos.length ? Math.max(...nos) : 1 };
}
/** What `trim(id, {keep})` would remove, without removing anything. Whole oldest chunks only, so the log can keep somewhat MORE than `keep`. */
export function trimPreview(id, { keep } = {}) {
  assertStaff();
  const l = find(id), p = pagesFor(l);
  return { ...MP.trimPreview(p.pages, p.secret, { keep: keep ?? Store.retention(l.scope), head: p.head, actorId: l.actorId }), keep: keep ?? Store.retention(l.scope), name: l.name, scope: l.scope };
}
export async function trim(id, { keep } = {}) {
  assertStaff();
  const l = find(id);
  const want = Math.floor(Number(keep ?? Store.retention(l.scope)));
  if (!(want > 0)) throw new Relay.LogError("badInput", { why: "keep" });
  if (Scribe.isScribe()) await Scribe.drain();
  const plan = await Store.pruneIfNeeded(actorLike(l), l.scope, want);
  Store.invalidate();
  return plan ? { removed: plan.removed, secretRemoved: plan.secretRemoved, pages: plan.dropPages.length, remain: plan.keep, first: plan.first, last: plan.last } : null;
}

/* ------------------------------------------------------------------ delete a log */
export async function remove(id) {
  assertStaff();
  const l = find(id);
  if (Scribe.isScribe()) await Scribe.drain();
  const gone = await Store.deleteLog(l.actorId);
  let fresh = false;
  if (l.actor && Scribe.isScribe()) fresh = await Scribe.rebaseline(l.actorId).catch(() => false);
  return { ...gone, fresh };
}

/* ------------------------------------------------------------------ export */
/** Data for one log file (the UI saves it). opts: {text(entry), labels, offsetMin} from the UI for localized prose. */
export function exportLog(id, fmt = "json", opts = {}) {
  assertStaff();
  const l = find(id);
  const entries = Store.readEntries(l.actorId, { secret: true });
  return X.exportEntries(entries, fmt, { actor: { id: l.actorId, name: l.name, uuid: l.uuid, type: l.scope }, exportedAt: Date.now(), exportedBy: game.user.name, users: usersMap(), scope: l.scope, ...(typeof opts.text === "function" ? { text: opts.text } : {}), ...(opts.labels ? { labels: opts.labels } : {}), ...(Number.isFinite(opts.offsetMin) ? { offsetMin: opts.offsetMin } : {}) });
}
/** Every log in one archive file (format ip-log-bundle). Import reads it back log by log. */
export function exportBundle() {
  assertStaff();
  const now = Date.now();
  const list = Store.listLogJournals().map((l) => ({ actor: { id: l.actorId, name: l.name, uuid: l.uuid, type: l.scope }, entries: Store.readEntries(l.actorId, { secret: true }) }));
  return { filename: X.exportName("table", "json", now), mime: X.MIME.json, text: X.toBundle(list, { exportedAt: now, exportedBy: game.user.name, users: usersMap() }), logs: list.length };
}

/* ------------------------------------------------------------------ import */
function targetFor(actorId) {
  const l = Store.listLogJournals().find((x) => x.actorId === actorId);
  if (l) return { id: l.actorId, name: l.name, scope: l.scope, actor: actorLike(l), exists: true };
  const a = game.actors.get(actorId);
  const scope = a ? Scribe.scopeOf(a, true) : null;
  return scope ? { id: a.id, name: a.name, scope, actor: a, exists: false } : null;
}
/** Plan an import without writing. opts: {target: actor/log id (the row it was started from), fileName}. */
export function previewImport(text, { target = null, fileName = "" } = {}) {
  assertStaff();
  const parsed = MP.parseImportFile(text);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, items: [], skipped: [] };
  const items = [], skipped = [], now = Date.now();
  for (const log of parsed.logs) {
    const label = log.actor?.name || "?";
    const wantId = target || log.actor?.id || "";
    if (target && parsed.kind === "bundle" && log.actor?.id !== target) continue;       // a bundle imported from one row: only that row's log
    const tg = wantId ? targetFor(wantId) : null;
    if (!tg) { skipped.push({ name: label, why: "noTarget" }); continue; }
    const existing = new Set(Store.readEntries(tg.id, { secret: true }).map((e) => e.id));
    const plan = MP.planImport(log, { scope: tg.scope, actorId: tg.id, existing, now, userId: game.user.id, from: fileName || label });
    if (!plan.ok) { skipped.push({ name: label, why: "scope", errors: plan.errors }); continue; }
    items.push({ targetId: tg.id, name: tg.name, scope: tg.scope, fileActor: log.actor, exportedAt: log.exportedAt, exportedBy: log.exportedBy, plan, targetActor: tg.actor, newLog: !tg.exists });
  }
  if (target && parsed.kind === "bundle" && !items.length && !skipped.length) skipped.push({ name: "", why: "noMember" });
  return { ok: true, kind: parsed.kind, errors: parsed.errors, items, skipped };
}
/** Import for real: plan again (the world may have changed since the preview), then write. Returns {written, logs:[{name, n, present, invalid}]}. */
export async function importLog(text, opts = {}) {
  assertStaff();
  const pv = previewImport(text, opts);
  if (!pv.ok) throw new Relay.LogError("badInput", { errors: pv.errors });
  if (Scribe.isScribe()) await Scribe.drain();
  const out = { written: 0, logs: [], skipped: pv.skipped };
  for (const it of pv.items) {
    if (!it.plan.entries.length) { out.logs.push({ name: it.name, n: 0, present: it.plan.present, invalid: it.plan.invalid }); continue; }
    await Store.importInto(it.targetActor, it.scope, it.plan.entries);
    out.written += it.plan.fresh;
    out.logs.push({ name: it.name, n: it.plan.fresh, present: it.plan.present, invalid: it.plan.invalid });
  }
  Store.invalidate();
  for (const it of pv.items) Store.emitChange({ actorId: it.targetId, op: "import", ids: [] });
  return out;
}

export const _tests = { find, targetFor };
