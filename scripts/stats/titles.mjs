/* Plus Ultra STATISTICS, THE TITLES OF A FIGHT (package AWRD), the writer. Runs on the active GM's client only (store.isWriter), like the
   capture: when the statistics change, every fight that ended in the last RECENT ms (or was never counted) gets its titles counted again
   (titles-pure.award) and, only when they differ from the stored ones, written with api.stats.setTitles. So a fight's titles follow an
   undo or a late fact after its end; a fight whose titles stand is never rewritten (the write would change the store and call this again). */
import * as Store from "./store.mjs";
import * as TP from "./titles-pure.mjs";

const MOD = Store.MOD;
const RECENT = 6 * 3600 * 1000, WAIT = 1200;
let timer = 0, started = false, setTitles = null;

function run() {
  timer = 0;
  try {
    if (!Store.isWriter() || !setTitles) return;
    const now = Date.now(), facts = Store.all().facts;
    for (const rec of Object.values(Store.fightsAll())) {
      if (!rec?.f || !rec.t1 || (rec.tm?.v === TP.TV && now - rec.t1 > RECENT)) continue;
      const got = TP.award(rec, facts);
      if (!TP.sameTitles(rec, got)) setTitles(rec.f, got.titles, got.meta);
    }
  } catch (e) { console.warn(`${MOD} | stats titles`, e); }
}
export const want = () => { clearTimeout(timer); timer = setTimeout(run, WAIT); };
export function start(api) {
  if (started) return;
  started = true; setTitles = api.setTitles;
  Store.subscribe(() => { if (Store.isWriter()) want(); });
  want();
}
