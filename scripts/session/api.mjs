/* End-of-session panel, phase S2: the public API, game.modules.get("invincible-plus-ultra").api.session. No window yet (S3 registers one with registerOpener()).
   Every write returns an ENVELOPE { ok, changed?, session?, error?: { key, code, params }, ... } and never throws; show errors with api.session.errText(error).
   Reads render from the world setting (sanitised, frozen): state(), summary(), status(), heroInfo(id), questions(). subscribe(fn) fires on every change of the session,
   the archive, the GM connection and the heroes' ownership (info.kind). Players can only answer (relay -> active GM); everything else is staff. */
import * as P from "./pure.mjs";
import * as OP from "./ops-pure.mjs";
import * as Store from "./store.mjs";
import * as Book from "./book.mjs";
import * as Relay from "./relay.mjs";
import * as GM from "./gm.mjs";
import * as Award from "./award.mjs";
import { t, errText } from "./lang.mjs";

const MOD = Store.MOD;
let opener = null, closer = null;
const act = (type, extra = {}) => Relay.request({ act: { type, ...extra } });
const cmd = (name, args = {}) => Relay.request({ cmd: name, args });
const myCtx = () => ({ user: { id: game.user.id, staff: Store.isStaff(game.user) }, owns: (id) => Store.owns(game.actors.get(id), game.user) });

/** Live facts of one hero in the session (the actor is re-read, the snapshot is only a fallback). */
export function heroInfo(id) {
  const a = game.actors.get(id), snap = Store.current()?.heroes.find((h) => h.id === id);
  if (!a) return { id, missing: true, name: snap?.name ?? t("IPL.Session.Hero.deleted"), img: snap?.img ?? "", karma: null, owners: [], mine: false };
  const owners = game.users.filter((u) => !u.isGM && Store.owns(a, u)).map((u) => ({ id: u.id, name: u.name, active: u.active }));
  return { id, missing: false, name: a.name, img: a.img || snap?.img || "", karma: Math.trunc(Number(a._source?.system?.karma) || 0), flaw: String(a._source?.system?.flaw ?? ""), owners, mine: Store.owns(a, game.user) };
}

export function status() {
  const s = Store.current();
  const gm = game.users.activeGM ?? null;
  return {
    gmOnline: !!gm, gm: gm?.name ?? null, writer: Store.iAmActiveGM(), hasSession: !!s, state: s?.state ?? null, view: P.view(s), rev: s?.rev ?? 0,
    resumable: s?.award?.state === "applying" || s?.award?.state === "undoing", mine: (s?.heroes ?? []).filter((h) => Store.owns(game.actors.get(h.id), game.user)).map((h) => h.id),
    allowPlayers: Store.setting(Store.SETTING_ALLOW, true) !== false, bookReady: Book.ready(), proto: OP.PROTO, transport: "channel", user: game.user?.id
  };
}

/** Summary of the session with live karma: rows (P.summary) + plan (before -> after from the heroes' CURRENT karma) + missing heroes. */
export function summary() {
  const s = Store.current();
  if (!s) return null;
  const karmaNow = {}, missing = [];
  for (const h of s.heroes) { const a = game.actors.get(h.id); if (!a) missing.push(h.id); else karmaNow[h.id] = Math.trunc(Number(a._source?.system?.karma) || 0); }
  return { ...P.summary(s), plan: P.awardPlan(s, karmaNow), missing, award: s.award, awards: s.awards };
}

export function canAnswer(hero, q) {
  const s = Store.current();
  if (!s) return false;
  const staff = Store.isStaff(game.user);
  if (!staff && Store.setting(Store.SETTING_ALLOW, true) === false) return false;
  return P.canAnswer(myCtx(), s, hero, q);
}
export const canNavigate = () => P.canNavigate(myCtx(), Store.current());

/** Open / refocus the panel (S3 registers the window through registerOpener; until then it only reports). */
export function open(opts) {
  if (opener) return opener(opts);
  console.info(`${MOD} | session: open() called, the panel window is not installed yet (S3)`, status());
  try { ui.notifications?.info(t("IPL.Session.Open.Stub")); } catch { /* no UI */ }
  return null;
}
export const close = () => (closer ? closer() : null);
export const registerOpener = (openFn, closeFn) => { opener = typeof openFn === "function" ? openFn : null; closer = typeof closeFn === "function" ? closeFn : null; };

export const sessionApi = {
  /* panel */
  open, close, registerOpener,
  /* reads */
  state: Store.current, status, summary, heroInfo, canAnswer, canNavigate, subscribe: Store.subscribe,
  questions: Book.questions, book: Book, archive: Store.archive, defaultHeroes: GM.defaultHeroes,
  /* writes (envelopes) */
  start: (opts = {}) => cmd("start", { heroes: opts.heroes, askBad: opts.askBad === true, includeGm: opts.includeGm === true }),
  answer: (hero, q, value) => act("setAnswer", { hero, q, value }),
  navigate: (where) => (where === "next" || where === "prev" ? act(where) : act("setQuestion", { index: where })),
  jump: (index) => act("setQuestion", { index }),
  closeSession: () => act("close"),
  reopen: () => act("reopen"),
  addHero: (hero) => cmd("addHero", { hero: typeof hero === "string" ? hero : hero?.id }),
  removeHero: (hero) => act("removeHero", { hero }),
  unlock: (hero, q) => act("unlock", { hero, q }),
  toggleBad: (value) => act("setAskBad", { value: value === undefined ? !Store.current()?.askBad : value === true }),
  award: (opts = {}) => Relay.request({ cmd: "award", args: { chat: typeof opts.chat === "boolean" ? opts.chat : undefined, _failAt: opts._failAt } }),
  undo: (opts = {}) => cmd("undo", { mode: opts.mode === "relative" ? "relative" : "strict" }),
  discard: () => cmd("discard"),
  dismiss: () => cmd("dismiss"),
  postSummary: () => cmd("postSummary"),
  /* misc */
  PROTO: OP.PROTO, errText, t, pure: P, ops: OP,
  relay: { request: Relay.request, _runAs: Relay._runAs, PROTO: Relay.PROTO },
  _internal: { Store, Award, GM, Book, Relay }
};

export function attach() {
  const mod = game.modules.get(MOD);
  if (!mod) return;
  (mod.api ??= {});
  mod.api.session = sessionApi;
}
