/* End-of-session panel, phase S3: the VIEW MODEL. Pure (no Foundry globals, no DOM): turns the session, the status and the live hero facts into one plain object that
   the views patch the DOM from. Tested in Node (check-ui.mjs). Everything the UI decides about "may this user tick this cell and why not" lives here, so the DOM
   code only paints. The reducer (pure.mjs) is still the authority; this is the explanation. */
import * as P from "../pure.mjs";

/** Why a cell cannot be changed by this user ("" = it can). Order matters: the most useful reason first. */
export function reasonOf({ s, staff, mine, cell, gmOnline, allowPlayers, atQuestion, missing = false }) {
  if (!s || s.state !== "open") return "closed";
  if (!atQuestion) return "summary";
  if (missing) return "missing";                                // S4-16: a deleted hero is not "somebody else's"; the GM removes it
  if (staff) return "";
  if (!allowPlayers) return "playersOff";
  if (!mine) return "notMine";
  if (cell && cell.g) return "locked";
  if (!gmOnline) return "noGM";
  return "";
}

/** "yes" | "no" | "none" from a stored value (null = nothing stored). */
export const stateOf = (v) => (v === null || v === undefined ? "none" : v >= 1 ? "yes" : "no");

/** env = { s, status, me: { id, staff }, questions: [{id,key,group,flaw?,label,text,index}], info(heroId), summary, pending: Map("hero|q" -> {v}) } */
export function build(env) {
  const { s, status = {}, me = {} } = env;
  const staff = !!me.staff;
  const base = {
    staff, me: me.id ?? "", gmOnline: !!status.gmOnline, gm: status.gm ?? null, allowPlayers: status.allowPlayers !== false,
    resumable: !!status.resumable, bookReady: !!status.bookReady
  };
  if (!s) return { ...base, view: "none", key: "none", state: null, askBad: false, index: 0, total: 0, rev: 0, canNav: false, dots: [], q: null, heroes: [], counts: { answered: 0, total: 0, waiting: [] }, sum: null, heroN: 0, mineAny: false, undecided: [] };
  const qs = env.questions?.length === P.total(s) ? env.questions : P.questions(!!s.askBad).map((q, index) => ({ id: q.id, key: q.key, group: q.group, ...(q.flaw ? { flaw: true } : {}), label: q.key, text: null, index }));
  const N = qs.length;
  const view = P.view(s);                                // "question" | "summary"
  const prog = P.progress(s);
  const atQuestion = view === "question";
  const cur = atQuestion ? qs[s.index] : null;
  const pending = env.pending ?? new Map();
  const missingIds = new Set(s.heroes.filter((h) => env.info(h.id)?.missing).map((h) => h.id));          // S4-16: deleted heroes never count as waiting
  const heroCount = s.heroes.length - missingIds.size;

  const goodN = P.GOOD.length;
  const dots = qs.map((q, i) => {
    const per0 = prog.per[q.id] ?? { answered: 0, yes: 0, pending: [] };
    const per = { ...per0, answered: per0.answered - s.heroes.filter((h) => missingIds.has(h.id) && !(per0.pending ?? []).includes(h.id)).length };
    const grp = q.group === "bad" ? "bad" : "good";
    const n = grp === "bad" ? i - goodN + 1 : i + 1;
    const state = atQuestion && i === s.index ? "current" : per.answered >= heroCount && heroCount ? "all" : per.answered > 0 ? "some" : "none";
    return { i, id: q.id, n, group: grp, answered: per.answered, total: heroCount, state, label: q.label };
  });

  let heroes = [];
  if (atQuestion && cur) {
    heroes = s.heroes.map((h) => {
      const info = env.info(h.id) ?? {};
      const cell = P.cellOf(s, cur.id, h.id);
      const pend = pending.get(`${h.id}|${cur.id}`) ?? null;
      const v = pend ? pend.v : cell ? cell.v : null;
      const reason = reasonOf({ s, staff, mine: !!info.mine, cell, gmOnline: base.gmOnline, allowPlayers: base.allowPlayers, atQuestion, missing: !!info.missing });
      return {
        id: h.id, name: info.name ?? h.name, img: info.img ?? h.img ?? "", missing: !!info.missing,
        owners: info.owners ?? [], mine: !staff && !!info.mine, flaw: String(info.flaw ?? ""), karma: info.karma ?? null,
        v, state: stateOf(v), locked: !!(cell && cell.g), busy: !!pend, reason, canToggle: reason === "" && !info.missing,
        canOver: !!cur.flaw && reason === "" && !info.missing, overcame: v === 2
      };
    });
  }

  const answeredNow = atQuestion && cur ? heroes.filter((h) => !h.missing && h.v !== null).length : 0;
  const counts = { answered: answeredNow, total: heroCount, waiting: atQuestion ? heroes.filter((h) => !h.missing && h.v === null).map((h) => h.name) : [] };

  // the summary rows: P.summary rows + the plan (before -> after from LIVE karma) or, once awarded, the award's own rows
  let sum = null;
  if (!atQuestion) {
    const raw = env.summary ?? { rows: [], plan: [], missing: [], award: s.award };
    const awardRows = new Map((s.award?.rows ?? []).map((r) => [r.h, r]));
    const awarded = !!s.award && (s.award.state === "done" || s.state === "awarded");
    const planBy = new Map((raw.plan ?? []).map((p) => [p.h, p]));
    const rows = raw.rows.map((r) => {
      const info = env.info(r.hero) ?? {};
      const ar = awardRows.get(r.hero);
      const plan = planBy.get(r.hero);
      const qn = r.yes.map((id) => ({ id, n: qs.findIndex((q) => q.id === id) + 1, label: qs.find((q) => q.id === id)?.label ?? id, bad: id.startsWith("b") }));
      return {
        id: r.hero, name: info.name ?? r.name, img: info.img ?? "", mine: !env.me.staff && !!info.mine, missing: !!info.missing, yes: qn, gain: r.gain, loss: r.loss, net: r.net, overcame: r.overcame,
        before: awarded && ar && ar.st !== 0 ? ar.before : plan ? plan.before : info.karma ?? null,
        after: awarded && ar && ar.st !== 0 ? ar.after : plan ? plan.after : null,
        applied: ar ? ar.st : null
      };
    });
    sum = {
      rows, askBad: !!s.askBad, awarded, gain: raw.gain ?? rows.reduce((a, r) => a + r.gain, 0), loss: raw.loss ?? rows.reduce((a, r) => a + r.loss, 0),
      overcame: rows.filter((r) => r.overcame).map((r) => r.name), missing: raw.missing ?? [], awardState: s.award?.state ?? null, n: s.award?.n ?? null
    };
  }

  return {
    ...base, view, key: `${view}:${s.id}`, sid: s.id, state: s.state, askBad: !!s.askBad, index: s.index, total: N, rev: s.rev,
    canNav: staff && s.state === "open", dots, q: cur ? { id: cur.id, key: cur.key, label: cur.label, text: cur.text && cur.text !== cur.label ? cur.text : null, group: cur.group, flaw: !!cur.flaw, n: dots[s.index].n, of: cur.group === "bad" ? P.BAD.length : goodN } : null,
    heroes, counts, sum, heroN: heroCount,
    mineAny: s.heroes.some((h) => env.info(h.id)?.mine),
    undecided: heroes.filter((h) => !h.missing && h.v === null).map((h) => h.id)
  };
}
