/* Plus Ultra STATISTICS, storage. ONE hidden world JournalEntry (id IPUStatsJournal1, ownership default OBSERVER so every player's client can
   read it through the API; hidden from the Journals sidebar) holds:
     entry flags[MOD].stats  = { v, head, hw, fights: { <fight key>: record (pure.newFight) }, actors: { <actor id>: { n, i, h, own:[user ids] } } }
     page  flags[MOD].stats  = { f: { <fact id>: fact } }      pages IPUStatsPage0001.., at most pure.PAGE_MAX facts each
   Facts are written by id (a partial flag update per page), so a write never rewrites a page and the same fact written twice is one fact.
   WRITER: only the active GM's client (isWriter); it batches every change of the last ~0.8 s into one update per touched page and one of
   the entry. Every client READS: all() parses the pages once per change (cached), the window asks for it only while it is open.
   Secrecy: as the activity log found (log-spec 4, L3), Foundry sends every world document to every client; what a player may not know is
   kept out of what the window SHOWS (pure.visible, pure.fightSummary), the same boundary as the tactical state on the Combat flags. */
import * as P from "./pure.mjs";

export const MOD = P.MOD;
export const JOURNAL_ID = "IPUStatsJournal1";
export const pageId = (n) => `IPUStatsPage${String(n).padStart(4, "0")}`;
/* a FRESH options object per call: Foundry writes parent, pack and more into the operation it is given, and a shared one turned the
   next journal update into an "embedded" one (live: fight records and late registry lines were never saved) */
const OPT = () => ({ render: false, ipuStats: true });
const subs = new Set();
let version = 0, cache = null, timer = 0, chain = Promise.resolve();
const Q = { put: new Map(), drop: new Set(), fights: new Map(), dropFights: new Set(), actors: new Map(), hw: 0 };

export const journal = () => { try { return game.journal?.get(JOURNAL_ID) ?? null; } catch { return null; } };
export const isStats = (doc) => doc?.id === JOURNAL_ID || doc?.parent?.id === JOURNAL_ID;
export const isWriter = () => { try { return !!game.user?.isGM && game.users.activeGM?.id === game.user.id; } catch { return false; } };
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function changed() { version++; cache = null; for (const fn of [...subs]) { try { fn(version); } catch (e) { console.warn(`${MOD} | stats subscriber`, e); } } }
export const ver = () => version;

/** everything, parsed once per change: { facts, fights, actors, hw } (never mutate) */
export function all() {
  if (cache) return cache;
  const j = journal(), root = j?.flags?.[MOD]?.stats ?? {};
  const pages = j ? [...j.pages].filter((p) => p.flags?.[MOD]?.stats).map((p) => p.flags[MOD].stats) : [];
  cache = { facts: P.factsOfPages(pages), fights: root.fights ?? {}, actors: root.actors ?? {}, hw: Number(root.hw) || 0 };
  return cache;
}
/** the fact ids already stored or waiting (the writer's own view, for de-duplication) */
export const has = (id) => Q.put.has(id) || all().facts.some((x) => x.id === id);

/* ------------------------------------------------------------------ the writer's queue */
export function put(facts) { for (const x of facts ?? []) if (x?.id) { Q.put.set(x.id, x); Q.drop.delete(x.id); } arm(); }
export function drop(ids) { for (const id of ids ?? []) { Q.put.delete(id); Q.drop.add(id); } arm(); }
export function dropWhere(sel) {
  const pending = [...Q.put.values()];
  drop(P.idsToDrop([...all().facts, ...pending], sel));
}
export function fight(key, rec) { if (key && rec) { Q.fights.set(key, rec); Q.dropFights.delete(key); arm(); } }
export function dropFight(key) { if (!key) return; Q.fights.delete(key); Q.dropFights.add(key); dropWhere({ f: key }); }
export function actor(id, rec) { if (id && rec) { Q.actors.set(id, rec); arm(); } }
export function highWater(t) { if (t > Q.hw) { Q.hw = t; arm(); } }
/** the facts queued and not saved yet (FXQ2: a fight closed right after its last action reads them too) */
export const queued = () => [...Q.put.values()].filter((x) => !Q.drop.has(x.id));
/** the fight record as stored or as queued */
export const fightRec = (key) => Q.fights.get(key) ?? all().fights[key] ?? null;
export const actorRec = (id) => Q.actors.get(id) ?? all().actors[id] ?? null;
/** every fight record, the queued ones included */
export const fightsAll = () => { const o = { ...all().fights }; for (const k of Q.dropFights) delete o[k]; for (const [k, r] of Q.fights) o[k] = r; return o; };

function arm() { if (!timer) timer = setTimeout(() => { timer = 0; chain = chain.then(flush).catch((e) => console.warn(`${MOD} | stats not saved`, e)); }, 800); }
export const settle = () => { if (timer) { clearTimeout(timer); timer = 0; chain = chain.then(flush).catch((e) => console.warn(`${MOD} | stats not saved`, e)); } return chain; };

async function ensure(hw = 0) {
  let j = journal();
  if (j) return j;
  j = await JournalEntry.create({ _id: JOURNAL_ID, name: "Plus Ultra: statistics", ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MOD]: { stats: { v: P.V, head: 1, hw, fights: {}, actors: {} } } } }, { keepId: true, ...OPT() });
  return j;
}
async function flush() {
  if (!isWriter()) { Q.put.clear(); Q.drop.clear(); Q.fights.clear(); Q.dropFights.clear(); Q.actors.clear(); return; }      // only the writer keeps what it saw
  if (!Q.put.size && !Q.drop.size && !Q.fights.size && !Q.dropFights.size && !Q.actors.size && !Q.hw) return;
  const puts = [...Q.put.values()], drops = [...Q.drop], fights = [...Q.fights], dropF = [...Q.dropFights], actors = [...Q.actors], hw = Q.hw;
  Q.put.clear(); Q.drop.clear(); Q.fights.clear(); Q.dropFights.clear(); Q.actors.clear(); Q.hw = 0;
  const j = await ensure();
  if (!j) return;
  const root = j.flags?.[MOD]?.stats ?? {};
  /* where each fact lives now */
  const where = new Map(), count = new Map();
  for (const p of j.pages) { const f = p.flags?.[MOD]?.stats?.f; if (!f) continue; count.set(p.id, Object.keys(f).length); for (const id of Object.keys(f)) where.set(id, p.id); }
  let head = Math.max(1, Number(root.head) || 1);
  const ups = new Map(), creates = [];
  const up = (pid) => { if (!ups.has(pid)) ups.set(pid, { _id: pid }); return ups.get(pid); };
  for (const x of puts) {
    const { id, ...body } = x;
    let pid = where.get(id);
    if (!pid) {
      pid = pageId(head);
      if ((count.get(pid) ?? 0) >= P.PAGE_MAX) { head++; pid = pageId(head); }
      count.set(pid, (count.get(pid) ?? 0) + 1); where.set(id, pid);
    }
    if (!j.pages.get(pid) && !creates.some((c) => c._id === pid)) creates.push({ _id: pid, name: pid, type: "text", text: { content: "" }, flags: { [MOD]: { stats: { f: {} } } } });
    up(pid)[`flags.${MOD}.stats.f.${id}`] = body;
  }
  for (const id of drops) { const pid = where.get(id); if (pid && j.pages.get(pid)) up(pid)[`flags.${MOD}.stats.f.-=${id}`] = null; }
  if (creates.length) await j.createEmbeddedDocuments("JournalEntryPage", creates, { keepId: true, ...OPT() });
  /* a fact created in a page created just now goes in with the page's update */
  if (ups.size) await j.updateEmbeddedDocuments("JournalEntryPage", [...ups.values()], OPT());
  const data = {};
  if (head !== Number(root.head)) data[`flags.${MOD}.stats.head`] = head;
  if (hw > (Number(root.hw) || 0)) data[`flags.${MOD}.stats.hw`] = hw;
  for (const [k, rec] of fights) data[`flags.${MOD}.stats.fights.${k}`] = rec;
  for (const k of dropF) data[`flags.${MOD}.stats.fights.-=${k}`] = null;
  for (const [k, rec] of actors) data[`flags.${MOD}.stats.actors.${k}`] = rec;
  if (Object.keys(data).length) await j.update(data, OPT());
}

/** GM: forget every statistic. FXQ2 (ADVS-D9): the journal is made again at once with the chat's newest card as its high-water mark, so
    the next GM load does not count again ("catch up") every roll still in the chat: a reset forgets them for good */
export async function reset() {
  if (!game.user?.isGM) return false;
  Q.put.clear(); Q.drop.clear(); Q.fights.clear(); Q.dropFights.clear(); Q.actors.clear(); Q.hw = 0;
  await settle();
  const j = journal();
  if (j) await j.delete(OPT());
  let hw = Date.now();
  try { for (const m of game.messages ?? []) hw = Math.max(hw, Number(m.timestamp) || 0); } catch { /* no chat */ }
  await ensure(hw);
  changed();
  return true;
}

/* the Journals sidebar never lists the store */
export function hideInDirectory(app, html) {
  try { const root = html instanceof HTMLElement ? html : html?.[0]; root?.querySelectorAll?.(`[data-entry-id="${JOURNAL_ID}"]`).forEach((li) => li.remove()); } catch { /* not a sidebar we know */ }
}
