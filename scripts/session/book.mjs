/* End-of-session panel, phase S2: the BOOK. Reads the ten karma questions (and the six bad-karma ones) at RUNTIME from the page "Your Hero's Growth" of the installed
   core book (module invincible-core, pack core-book) and keeps them in memory only; nothing of the book is stored in the repo or in the world. When the book is missing,
   unreadable or shaped differently, every question falls back to our own short label from the module language (IPL.Session.q.<key>). */
import * as P from "./pure.mjs";
import * as OP from "./ops-pure.mjs";
import { t } from "./lang.mjs";

const PACK = "invincible-core.core-book";
const KNOWN_JOURNAL = "Rbx4P6GQT5EoFNUG";
const KNOWN_PAGE = "R9r1Q30fr2xjoeK0";
const PAGE_RE = /hero.{0,2}s\s+growth/i;
let cached = null, loading = null, loadedAt = 0;
const TTL = 10 * 60 * 1000;

async function findPage() {
  const pack = game.packs?.get(PACK);
  if (!pack) return null;
  try {                                                                       // fast path: the ids this book release uses
    const j = await pack.getDocument(KNOWN_JOURNAL);
    const p = j?.pages?.get(KNOWN_PAGE);
    if (p && PAGE_RE.test(p.name)) return p;
  } catch { /* another release: search */ }
  const index = await pack.getIndex();
  for (const e of index) {                                                     // slow path: the chapter journals, page by name
    if (!/superhero/i.test(e.name ?? "")) continue;
    const j = await pack.getDocument(e._id);
    const p = j?.pages?.find((x) => PAGE_RE.test(x.name));
    if (p) return p;
  }
  return null;
}

/** Resolves { source: "book"|"fallback", good: string[]|null, bad: string[]|null }. Cached in memory for 10 minutes; concurrent calls share one read. Never throws. */
export function load({ force = false } = {}) {
  if (!force && cached && Date.now() - loadedAt < TTL) return Promise.resolve(cached);
  if (loading) return loading;
  loading = (async () => {
    let out = { source: "fallback", good: null, bad: null };
    try {
      const page = await findPage();
      const parsed = OP.parseBook(page?.text?.content ?? "");
      if (parsed.good || parsed.bad) out = { source: "book", ...parsed };
    } catch (e) { console.warn(`${P.MOD_ID} | session: core book not readable, using the short labels`, e); }
    cached = out; loadedAt = Date.now(); loading = null;
    return out;
  })();
  return loading;
}
export const invalidate = () => { cached = null; loadedAt = 0; };
export const ready = () => !!cached;
/** Text of one question from the book (sync, after load()); null when the book does not provide it. */
export function text(qid) {
  if (!cached) return null;
  const gi = P.GOOD.findIndex((q) => q.id === qid);
  if (gi >= 0) return cached.good?.[gi] ?? null;
  const bi = P.BAD.findIndex((q) => q.id === qid);
  return bi >= 0 ? cached.bad?.[bi] ?? null : null;
}
/** Our own short label (always available, EN or PL). */
export const label = (qid) => { const q = P.questionById(qid); return q ? t(`IPL.Session.q.${q.key}`) : ""; };
/** All questions for display: [{ id, key, group, flaw?, label, text|null, index }]. askBad adds the six bad-karma ones. Awaits load(). */
export async function questions(askBad = false) {
  await load();
  return P.questions(!!askBad).map((q, index) => ({ id: q.id, key: q.key, group: q.group, ...(q.flaw ? { flaw: true } : {}), label: label(q.id), text: text(q.id), index }));
}
