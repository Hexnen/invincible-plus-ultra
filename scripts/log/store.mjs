/* Activity log - STORE (phase L3). Hidden world JournalEntry per logged actor (public log, id-keyed chunk pages in page flags) + ONE GM-only journal (secret entries,
   annotations, per-actor snapshots). Writes are partial diffs, never touch an Actor document, and are done by the scribe only (GM). Reads work on every client for the
   journals it may see. Spec 3.2, 3.5, 3.6, 4. Journal ids are deterministic (= the actor id; GM journal and folder fixed) so two scribe tabs collide instead of duplicating. */
import { MOD_ID as MOD, retentionFor, POLICY } from "./events.mjs";
import * as M from "./model.mjs";
import * as P from "./prune.mjs";
import * as C from "./capture-pure.mjs";

export const FOLDER_NAME = "Plus Ultra - Logs";
export const GM_JOURNAL_NAME = "Log: GM only";
export const stats = { pageUpdates: 0, pageCreates: 0, journalUpdates: 0, entriesWritten: 0, skipped: 0, snapWrites: 0, prunes: 0, failures: 0 };

/* ------------------------------------------------------------------ settings (registered by main.mjs) */
export function setting(key, fallback) {
  try { const k = `${MOD}.${key}`; if (game.settings.settings.has(k)) return game.settings.get(MOD, key); } catch { /* not ready */ }
  return fallback;
}
export function policy() {
  let over = {};
  try { const raw = setting("logPolicy", ""); if (raw) over = JSON.parse(raw); } catch { /* ignore */ }
  return { ...POLICY, ...over };
}
export const readAccess = () => setting("logReadAccess", policy().readAccess);
export const enabled = () => setting("logEnabled", true) !== false;
/** Cap for a scope. Heroes: `logRetainEntries`. Bases: `logRetainBase` when it is >= 0 (an explicit override, 0 = unlimited), else 60 percent of the hero cap. */
export function retention(scope) {
  const base = Number(setting("logRetainBase", -1));
  return retentionFor(scope, { retainHero: Number(setting("logRetainEntries", POLICY.retainHero)), ...(Number.isFinite(base) && base >= 0 ? { retainBase: base } : {}) });
}
export function scopeIds() { try { const raw = setting("logScope", ""); const a = raw ? JSON.parse(raw) : null; return Array.isArray(a) && a.length ? a : null; } catch { return null; } }

/* ------------------------------------------------------------------ lookups */
export const isLogJournal = (j) => !!j && j.documentName === "JournalEntry" && !!j.flags?.[MOD]?.log;
export const logFolder = () => game.folders?.get(C.LOG_FOLDER_ID) ?? null;
export function actorJournal(actorId) { const j = game.journal?.get(actorId); return j && j.flags?.[MOD]?.log?.kind === "actor" ? j : null; }
export const gmJournal = () => { const j = game.journal?.get(C.GM_JOURNAL_ID); return j && j.flags?.[MOD]?.log?.kind === "gm" ? j : null; };
export function allLogJournalIds() { return (game.journal?.contents ?? []).filter(isLogJournal).map((j) => j.id); }

/** {no: pageDoc} of the public pages of an actor journal, or of the secret pages of one actor inside the GM journal. */
export function pageDocs(journal, secretFor = null) {
  const out = {};
  if (!journal) return out;
  for (const p of journal.pages) {
    const pn = M.parseChunkName(p.name);
    if (!pn) continue;
    if (secretFor ? pn.actorId !== secretFor : pn.actorId) continue;
    out[pn.no] = p;
  }
  return out;
}
const pageObj = (doc) => doc.flags?.[MOD]?.log ?? M.emptyPage(0);
export function pagesOf(journal, secretFor = null) {
  const docs = pageDocs(journal, secretFor), out = {};
  for (const [no, d] of Object.entries(docs)) out[no] = pageObj(d);
  return out;
}

/* ------------------------------------------------------------------ read cache */
const cache = new Map();   // key -> {n, entries}
const listeners = new Set();
let version = 0;
export function invalidate(actorId) { version++; if (actorId) cache.delete(actorId); else cache.clear(); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitChange(info) { for (const fn of listeners) { try { fn(info); } catch (e) { console.warn(`${MOD} | log subscriber failed`, e); } } }

/** Merged, sorted entries of an actor visible to the current user: public pages, plus the secret pages for a GM. */
export function readEntries(actorId, { secret = game.user?.isGM } = {}) {
  const key = `${actorId}|${secret ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && hit.v === version) return hit.entries;
  const pub = pagesOf(actorJournal(actorId));
  let entries = M.readAll(pub);
  if (secret) {
    const sec = pagesOf(gmJournal(), actorId);
    const sx = M.readAll(sec);
    if (sx.length) entries = M.sortEntries([...entries, ...sx]);
  }
  cache.set(key, { v: version, entries });
  return entries;
}
export function findEntry(actorId, id) {
  const pub = pagesOf(actorJournal(actorId));
  for (const p of Object.values(pub)) if (p.e && p.e[id]) return { entry: p.e[id], secret: false };
  const gm = gmJournal();
  if (gm) for (const p of Object.values(pagesOf(gm, actorId))) if (p.e && p.e[id]) return { entry: p.e[id], secret: true };
  return null;
}
export function counts(actorId) {
  const pub = pagesOf(actorJournal(actorId));
  const gm = gmJournal();
  const sec = gm ? pagesOf(gm, actorId) : {};
  const bytes = (o) => Object.values(o).reduce((n, p) => n + (p.bytes || M.byteSize(p.e || {})), 0);
  const all = { ...pub };
  return { count: M.totalCount(pub), secret: M.totalCount(sec), chunks: Object.keys(pub).length, secretChunks: Object.keys(sec).length, bytes: bytes(pub) + bytes(sec), first: Math.min(...Object.values(all).map((p) => p.first || Infinity), Infinity), last: Math.max(...Object.values(all).map((p) => p.last || 0), 0) };
}

/* ------------------------------------------------------------------ GM-side creation */
const O = () => ({ render: false, ipLog: true });
async function createKeepId(Doc, data, parent) {
  try { return { doc: await Doc.create(data, { ...O(), keepId: true, ...(parent ? { parent } : {}) }), created: true }; }
  catch (e) {
    const found = Doc === Folder ? game.folders.get(data._id) : game.journal.get(data._id);
    if (found) return { doc: found, created: false };
    throw e;
  }
}
export async function ensureFolder() {
  const f = logFolder();
  if (f) return f;
  return (await createKeepId(Folder, { _id: C.LOG_FOLDER_ID, name: FOLDER_NAME, type: "JournalEntry", flags: { [MOD]: { logFolder: true } } })).doc;
}
const readerIds = (actor) => C.readersOf(actor._source.ownership ?? {}, game.users.map((u) => ({ id: u.id, isGM: u.isGM })), readAccess());
/** Find or create the public journal of an actor. Returns {journal, created}. GM only. */
export async function ensureJournal(actor, scope) {
  const have = actorJournal(actor.id);
  if (have) return { journal: have, created: false };
  const folder = await ensureFolder();
  const meta = { v: 1, kind: "actor", actorId: actor.id, actorUuid: actor.uuid, name: actor.name, type: scope, created: Date.now() };
  const r = await createKeepId(JournalEntry, { _id: actor.id, name: `Log: ${actor.name}`, folder: folder.id, ownership: C.journalOwnership(readerIds(actor)), flags: { [MOD]: { log: meta } } });
  return { journal: r.doc, created: r.created };
}
export async function ensureGmJournal() {
  const have = gmJournal();
  if (have) return have;
  const folder = await ensureFolder();
  const r = await createKeepId(JournalEntry, { _id: C.GM_JOURNAL_ID, name: GM_JOURNAL_NAME, folder: folder.id, ownership: { default: 0 }, flags: { [MOD]: { log: { v: 1, kind: "gm", created: Date.now() } } } });
  return r.doc;
}

/** Re-derive the ownership of an actor's journal from the actor's ownership and the read-access setting (scribe only). */
export async function reconcile(actor) {
  const j = actorJournal(actor.id);
  if (!j) return false;
  const want = C.journalOwnership(readerIds(actor));
  const have = j._source.ownership ?? {};
  const own = {};
  for (const [k, v] of Object.entries(want)) if (have[k] !== v) own[k] = v;
  // a user that must lose access goes to INHERIT (-1): "-=id" keys are refused by the typed ownership mapping; GM entries are never touched
  for (const k of Object.keys(have)) if (!(k in want) && have[k] !== -1 && !game.users.get(k)?.isGM) own[k] = -1;
  if (!Object.keys(own).length) return false;
  stats.journalUpdates++;
  await j.update({ ownership: own }, O());   // nested object, never dotted keys: the ownership field is a typed mapping
  return true;
}
export async function flagJournal(actorId, patch) {
  const j = actorJournal(actorId);
  if (!j) return;
  const upd = {}; for (const [k, v] of Object.entries(patch)) upd[`flags.${MOD}.log.${k}`] = v;
  stats.journalUpdates++;
  await j.update(upd, O());
}

/* ------------------------------------------------------------------ snapshots (GM journal flags, keys encoded) */
export function loadSnapshot(actorId) {
  const raw = gmJournal()?.flags?.[MOD]?.log?.snaps?.[actorId];
  return raw ? C.decodeSnap(raw) : null;
}
export async function writeSnapshot(actorId, ops) {
  const gm = await ensureGmJournal();
  const upd = {};
  const base = `flags.${MOD}.log.snaps.${actorId}`;
  for (const [k, v] of Object.entries(ops.set)) upd[`${base}.${k}`] = v;
  for (const k of ops.del) upd[`${base}.-=${k}`] = null;
  stats.snapWrites++; stats.journalUpdates++;
  await gm.update(upd, O());
}

/* ------------------------------------------------------------------ writing entries */
async function writeSet(journal, secretFor, entries, forced) {
  const docs = pageDocs(journal, secretFor);
  const pages = {};
  for (const [no, d] of Object.entries(docs)) pages[no] = pageObj(d);
  const idx = M.buildIndex(pages);
  // idempotent: an identical entry already there is skipped; a different version of the same id is merged deterministically (two scribe tabs)
  const todo = [];
  for (const e of entries) {
    const known = idx.get(e.id);
    if (known === undefined) { todo.push(e); continue; }
    const old = pages[known].e[e.id];
    if (M.deepEqual(old, e)) { stats.skipped++; continue; }
    const pick = forced ? e : M.mergeEntry(old, e);
    if (pick === old) { stats.skipped++; continue; }
    todo.push(pick);
  }
  if (!todo.length) return { written: 0, pages };
  const nos = Object.keys(pages).map(Number);
  const head = nos.length ? Math.max(...nos) : 1;
  const plan = M.planWrite({ head, pages }, todo);
  const planIdx = M.buildIndex(plan.pages);
  const updates = [], creates = [];
  const byPage = new Map();
  for (const e of todo) { const no = planIdx.get(e.id); if (!byPage.has(no)) byPage.set(no, []); byPage.get(no).push(e); }
  for (const [no, list] of byPage) {
    const pg = plan.pages[no];
    if (docs[no]) {
      const u = { _id: docs[no].id, [`flags.${MOD}.log.n`]: pg.n, [`flags.${MOD}.log.first`]: pg.first, [`flags.${MOD}.log.last`]: pg.last, [`flags.${MOD}.log.bytes`]: pg.bytes };
      for (const e of list) u[`flags.${MOD}.log.e.${e.id}`] = e;
      updates.push(u);
    } else {
      creates.push({ _id: C.pageDocId(secretFor || journal.id, no, !!secretFor), name: M.chunkName(no, secretFor), type: "text", text: { content: "" }, sort: no * 10, flags: { [MOD]: { log: pg } } });
    }
  }
  if (updates.length) { stats.pageUpdates += updates.length; await journal.updateEmbeddedDocuments("JournalEntryPage", updates, O()); }
  if (creates.length) {
    stats.pageCreates += creates.length;
    try { await journal.createEmbeddedDocuments("JournalEntryPage", creates, { ...O(), keepId: true }); }
    catch (e) {   // the other scribe tab created the page first: write the entries into it instead
      const again = pageDocs(journal, secretFor);
      for (const c of creates) {
        const no = M.parseChunkName(c.name).no;
        if (!again[no]) throw e;
        const u = { _id: again[no].id, [`flags.${MOD}.log.n`]: c.flags[MOD].log.n };
        for (const [id, en] of Object.entries(c.flags[MOD].log.e)) u[`flags.${MOD}.log.e.${id}`] = en;
        stats.pageUpdates++;
        await journal.updateEmbeddedDocuments("JournalEntryPage", [u], O());
      }
    }
  }
  stats.entriesWritten += todo.length;
  return { written: todo.length, pages: plan.pages };
}

/** Write one batch for an actor: pub / sec = new entries (public journal / GM journal), patches = forced rewrites of existing entries (explain, push). */
export async function commit(actor, scope, { pub = [], sec = [], patches = [] }) {
  const j = (await ensureJournal(actor, scope)).journal;
  const pubPatch = [], secPatch = [];
  for (const p of patches) (p.secret ? secPatch : pubPatch).push(p.entry);
  if (pub.length || pubPatch.length) {
    await writeSet(j, null, pub, false);
    if (pubPatch.length) await writeSet(j, null, pubPatch, true);
  }
  if (sec.length || secPatch.length) {
    const gm = await ensureGmJournal();
    await writeSet(gm, actor.id, sec, false);
    if (secPatch.length) await writeSet(gm, actor.id, secPatch, true);
  }
  invalidate(actor.id);
  return j;
}

/* ------------------------------------------------------------------ retention */
export async function pruneIfNeeded(actor, scope, capOverride = null) {
  const cap = capOverride ?? retention(scope);
  const j = actorJournal(actor.id);
  if (!j || !cap) return null;
  const pages = pagesOf(j);
  if (M.totalCount(pages) <= cap) return null;
  const gm = gmJournal();
  const secret = gm ? pagesOf(gm, actor.id) : null;
  const head = Math.max(...Object.keys(pages).map(Number));
  const plan = P.planPrune(pages, { cap, head, actorId: actor.id, secret });
  if (!plan) return null;
  const docs = pageDocs(j);
  const ids = plan.dropPages.map((no) => docs[no]?.id).filter(Boolean);
  if (ids.length) await j.deleteEmbeddedDocuments("JournalEntryPage", ids, O());
  if (gm && plan.dropSecret.length) {
    const sd = pageDocs(gm, actor.id);
    const sids = plan.dropSecret.map((no) => sd[no]?.id).filter(Boolean);
    if (sids.length) await gm.deleteEmbeddedDocuments("JournalEntryPage", sids, O());
  }
  const marker = M.normalizeEntry({ ...plan.marker, id: plan.marker.id }, { actorId: actor.id });
  await commit(actor, scope, { pub: [marker] });
  stats.prunes++;
  return plan;
}

/* ------------------------------------------------------------------ maintenance (L6; the callers check the role) */
/** Every per-actor log journal of the world (live actors AND orphans of deleted actors). */
export function listLogJournals() {
  return (game.journal?.contents ?? []).filter((j) => j.flags?.[MOD]?.log?.kind === "actor").map((j) => {
    const m = j.flags[MOD].log, aid = m.actorId ?? j.id, actor = game.actors?.get(aid) ?? null;
    return { id: j.id, actorId: aid, name: actor?.name ?? m.name ?? j.name, scope: m.type === "base" ? "base" : "hero", orphan: !actor, deletedAt: Number(m.deletedAt) || 0, actor, uuid: actor?.uuid ?? m.actorUuid ?? "" };
  });
}
/** Delete the whole log of an actor: the public journal (with its pages), the actor's pages in the GM journal and its snapshot. Returns the counts that were removed. */
export async function deleteLog(actorId) {
  const j = actorJournal(actorId);
  const gm = gmJournal();
  const out = { entries: j ? M.totalCount(pagesOf(j)) : 0, secret: gm ? M.totalCount(pagesOf(gm, actorId)) : 0, chunks: j ? j.pages.size : 0 };
  if (gm) {
    const ids = Object.values(pageDocs(gm, actorId)).map((p) => p.id);
    if (ids.length) { stats.journalUpdates++; await gm.deleteEmbeddedDocuments("JournalEntryPage", ids, O()); }
    if (gm.flags?.[MOD]?.log?.snaps?.[actorId] !== undefined) { stats.journalUpdates++; await gm.update({ [`flags.${MOD}.log.snaps.-=${actorId}`]: null }, O()); }
  }
  if (j) await j.delete(O());
  invalidate();
  emitChange({ actorId, op: "deleteLog", ids: [] });
  return out;
}
/** Write imported entries (already planned and validated by maint-pure.planImport) into an actor's log. Entries flagged `v` go to the GM journal. */
export async function importInto(actor, scope, entries) {
  const pub = entries.filter((e) => !e.v), sec = entries.filter((e) => e.v);
  const BATCH = 200;
  for (let i = 0; i < pub.length; i += BATCH) await commit(actor, scope, { pub: pub.slice(i, i + BATCH) });
  for (let i = 0; i < sec.length; i += BATCH) await commit(actor, scope, { sec: sec.slice(i, i + BATCH) });
  return { pub: pub.length, sec: sec.length };
}

/* ------------------------------------------------------------------ hiding (sidebar) */
export function hideInDirectory(app, html) {
  try {
    if (game.settings.get(MOD, "logRevealJournals") === true) return;
  } catch { /* setting missing: hide */ }
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  root.querySelectorAll(`[data-folder-id="${C.LOG_FOLDER_ID}"]`).forEach((n) => n.remove());
  for (const id of allLogJournalIds()) root.querySelectorAll(`[data-entry-id="${id}"]`).forEach((n) => n.remove());
}
