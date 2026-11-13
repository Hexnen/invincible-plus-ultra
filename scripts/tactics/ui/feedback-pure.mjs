/* Tactical combat, the surfaces: FEEDBACK TO THE PLAYER (ledger rows U53 - U58, U68). NO Foundry or browser globals (node-tested in
   check-u10.mjs). Everything here is built from what the client already holds: the dock's own data, THIS USER'S view of the fight
   (view-pure.mjs: a concealed combatant is not in it) and the public events of the fight (spec 16). Nothing is asked of the executor
   and nothing is sent anywhere: a player's client can only say what that player's view holds.
     whyOf(t, reason, params, o)     U54 / U68: why a greyed thing cannot be used and what to do to be able to -> { text, fix } | null
     poolTip(pool, t)                U55: where the dice of a pool come from, as a tooltip of the model -> { title, rows, total, ... }
     floats(events, t)               U56: what stands over a token when an exchange is settled -> [{ target, text, tone }]
     tallyAdd / roundCard / fightCard  U57: what a round and a fight came to, from the news of the user's view
     cues(prev, now)                 U58: which of the two sounds is due -> { cue: "turn" | "wait" | null, next }
     hintOf(data, seen) / hintsUsed  U53: the one first-fight hint to show now, and the ones the user has just made use of */

/* ------------------------------------------------------------------ U54 / U68: why not, and what to do */
import * as NewsP from "./news-pure.mjs";      // BH4-1: what a news id says (its seq, its fight)
const has = (t, key) => t(key, {}, null) !== null;
/** `reason` = the engine's own word (desk-pure.barModel `disabled`, a legality answer, a prompt option's `disabled`).
    o.ctx: where it is asked ("holdOff": the same word means another thing there); o.staff: the GM's own way round a refusal.
    o.ask === false: a click on the thing opens no way to ask (an answer on a card): then no fallback fix.
    The text is ALWAYS a whole sentence (U68: "no action" under "full action" read as a second price). */
export function whyOf(t, reason, params = {}, o = {}) {
  if (!reason) return null;
  const id = String(reason), keys = [...(params?.series ? [`series.${id}`] : []), ...(o.ctx ? [`${o.ctx}.${id}`, id] : [id])];      // FXV (P8f-6): a series (full auto) has its own words
  const wk = keys.find((k) => has(t, `ITAC.why.${k}`)), fk = keys.find((k) => has(t, `ITAC.fix.${k}`));
  const text = wk ? t(`ITAC.why.${wk}`, params) : t("ITAC.why.other", { reason: t(`ITAC.reason.${id}`, params, id) });
  /* a sentence of its own with no remedy (dead, Resolve already full) gets none; an unknown reason gets the way to ask */
  const fix = fk ? t(`ITAC.fix.${fk}`, params) : wk || o.ask === false ? null : t(o.staff ? "ITAC.fix.gm" : "ITAC.fix.ask");
  return { text, fix };
}
/** FXS2 (U231): during a chase nobody has turns (the round is played in the chase panel), so "not your turn, wait for your card on the
    initiative bar" sends a player to wait for a card that never comes: the same reason is said in the chase's own words. -> a `t` */
const CHASE_WORDS = Object.freeze({ "ITAC.why.notYourTurn": "ITAC.why.chase.notYourTurn", "ITAC.fix.notYourTurn": "ITAC.fix.chase.notYourTurn", "ITAC.reason.notYourTurn": "ITAC.reason.chase.notYourTurn" });
export const chaseT = (t) => (key, data, fb) => t(CHASE_WORDS[key] ?? key, data, fb);
/** the two sentences as one line (a place with room for a single string: the map's menu, a row's aria-label) */
export const whyLine = (w) => (w ? [w.text, w.fix].filter(Boolean).join(" ") : null);

/* ------------------------------------------------------------------ U55: where the dice come from */
const signed = (n, first) => (first ? String(n) : n > 0 ? `+${n}` : String(n));
/** `pool` = { total, parts: [{ label, dice, pending? }] } (model-pure.declarePanel: the engine's own answer for this declaration).
    Dice that still wait for the GM's word are listed apart and are not in the total. -> a tooltip of the model with `rows` */
export function poolTip(pool, t) {
  if (!pool || !Array.isArray(pool.parts) || !pool.parts.length) return null;
  const sure = pool.parts.filter((x) => !x.pending), wait = pool.parts.filter((x) => x.pending);
  const rows = sure.map((x, i) => ({ label: String(x.label ?? ""), value: signed(Number(x.dice) || 0, i === 0) }));
  const more = wait.map((x) => ({ label: String(x.label ?? ""), value: signed(Number(x.dice) || 0, false) }));
  return { title: null, cost: null, lines: [], note: null, rows, total: { label: t("ITAC.ui.pool.total"), value: String(pool.total) }, ...(more.length ? { wait: { label: t("ITAC.ui.pool.wait"), rows: more } } : {}),
    say: t("ITAC.ui.pool.say", { n: pool.total, parts: [...rows, ...more].map((r) => `${r.label} ${r.value}`).join(", ") }) };
}
/** a roll record's own pool ({ base, mods: [{ source, dice }], total }; in a player's view only for a roller whose numbers that player may know) */
export function rollPool(r, t, attrLabel) {
  const p = r?.pool;
  if (!p || !Number.isFinite(p.base) || !Array.isArray(p.mods)) return null;
  const mods = p.mods.filter((m) => m && Number(m.dice)).slice(0, 24);
  const total = Number.isFinite(p.total) ? p.total : Number.isFinite(p.dice) ? p.dice : p.base + mods.reduce((n, m) => n + Number(m.dice), 0);
  return { total, parts: [{ label: attrLabel || t("ITAC.mod.base"), dice: p.base }, ...mods.map((m) => ({ label: t(`ITAC.mod.${String(m.source).split(":")[0]}`, {}, String(m.label ?? m.source)), dice: Number(m.dice) }))] };
}

/* ------------------------------------------------------------------ U56: numbers over tokens */
const idOf = (x) => (typeof x === "string" ? x : x && typeof x === "object" && typeof x.combatant === "string" ? x.combatant : null);
/** One batch of events of one exchange (the public ones on a player's client, spec 16: a concealed combatant is in none of them).
    Per target ONE word for the defence that worked or the miss, or the loss it took (a hit that did no damage of its own says "Hit").
    tone: "health" | "resolve" | "miss" | "none" | "state" (the surface gives each its own colour AND its own word: U63).
    hit: the bare word "Hit"; loss: a number. The two of one blow may come in two batches (a question in between): the surface
    then leaves out a "Hit" that comes after the number. */
export function floats(events, t) {
  const out = [], hurt = new Set(), list = (events ?? []).filter((e) => e && typeof e === "object");
  for (const e of list) if (e.type === "damage" && idOf(e.target)) hurt.add(idOf(e.target));
  for (const e of list) {
    const target = idOf(e.target);
    if (!target) continue;
    if (e.type === "outcome" && typeof e.hit === "boolean") {
      if (!e.hit) out.push({ target, tone: "miss", text: t(e.blocked ? "ITAC.float.block" : e.dodged ? "ITAC.float.dodge" : "ITAC.float.miss") });
      else if (!hurt.has(target)) out.push({ target, tone: "none", text: t("ITAC.float.hit"), hit: true, blow: e.inst ?? null });
    } else if (e.type === "damage" && Number.isFinite(e.taken)) {
      const n = Math.max(0, Math.trunc(e.taken));
      out.push(n > 0 ? { target, tone: e.toStress ? "resolve" : "health", text: t(e.toStress ? "ITAC.float.resolve" : "ITAC.float.health", { n }), num: `-${n}`, mark: e.toStress ? "stress" : "health", loss: true }      /* U93: the number with the mark of what was lost (`num`, `mark`); `text` is the same in words, for a canvas that cannot draw the mark */ : { target, tone: "none", text: t("ITAC.float.none"), loss: true });
      out[out.length - 1].blow = e.inst ?? null;
    } else if (e.type === "broken") out.push({ target, tone: "state", text: t("ITAC.float.broken") });
    else if (e.type === "crit" && Number.isFinite(e.crit?.total)) {      // D127: what the injury die came to, over the token, on every seat that sees it
      const k = String(e.crit.id ?? "").replace(/-(\w)/g, (m, c) => c.toUpperCase()), name = k ? t(`ITAC.crit.${k}`, {}, "") : "";
      out.push({ target, tone: "state", text: name ? t("ITAC.float.crit", { n: Math.trunc(e.crit.total), name }) : t("ITAC.journal.crit") });
    }
  }
  return out.slice(0, 40);
}
/** ANSH (U10-6, the user 2026-11-12: «Sama liczba -N Zdrowie»): over the token stands the loss alone; the bare "Hit" only when the blow
    did no damage at all. A "Hit" whose blow (the action instance) is still open may yet be followed by its number (a question in between),
    so it waits: a loss of the same blow drops it, the close of the action (`actionClosed`) shows it. A "Hit" of no known blow shows at once.
    held = { [target]: { blow, f } } -> { show: [floats], held } */
export function holdHits(held, events, fl) {
  const next = { ...(held ?? {}) }, show = [];
  for (const f of fl ?? []) {
    if (f.hit && f.blow != null) { next[f.target] = { blow: f.blow, f }; continue; }
    if (f.loss && next[f.target] && (f.blow == null || next[f.target].blow === f.blow)) delete next[f.target];
    show.push(f);
  }
  const closed = new Set((events ?? []).filter((e) => e && e.type === "actionClosed" && e.inst != null).map((e) => e.inst));
  for (const [tg, h] of Object.entries(next)) if (closed.has(h.blow)) { show.push(h.f); delete next[tg]; }
  return { show, held: next };
}
/** the key an event is known by on a client that hears it twice (the executor hears the full stream and the public one) */
export const eventKey = (e) => `${e?.combat ?? ""}|${e?.fight ?? ""}|${e?.seq ?? ""}|${e?.type ?? ""}|${idOf(e?.target) ?? ""}`;

/* ------------------------------------------------------------------ U57: the summary of a round and of a fight */
const newsNo = NewsP.newsNo;      // BH4-1: the seq of "n<seq>_<fight>" (news-pure), not every digit of the id
export const TALLY_MAX = 400;
/** Keep what the news of the user's view says about actions that came to something (view.news: at most the last twelve lines, so the
    client adds them as they come). `tally` = { combat, entries: { <news no>: { round, actor, rows: [{ target, hit?, taken?, stress? }], undone } } }.
    An undone action is marked, not removed (the news marks it too). -> the tally (the same object when nothing changed) */
export function tallyAdd(tally, combatId, news) {
  /* BH4-1: the tally is of ONE fight: a fight started again on the same Combat (its lines count from 1 again, under another tag) starts
     its own, so its round cards never count the actions of the fight before it */
  const fight = NewsP.fightOfList((news ?? []).filter((n) => n?.kind === "action"));
  let out = tally && tally.combat === combatId && (!fight || !tally.fight || tally.fight === fight) ? tally : { combat: combatId, entries: {} }, changed = out !== tally;
  if (fight && out.fight !== fight) { out = { ...out, fight, entries: { ...out.entries } }; changed = true; }
  for (const n of news ?? []) {
    if (!n || n.kind !== "action") continue;
    const no = newsNo(n), rows = (n.rows ?? []).filter((r) => r && typeof r.target === "string" && (typeof r.hit === "boolean" || Number.isFinite(r.taken)));
    if (!no || !rows.length) continue;
    const was = out.entries[no], undone = n.undone ? 1 : 0;
    if (was && was.undone === undone) continue;
    if (!changed) { out = { combat: out.combat, ...(out.fight ? { fight: out.fight } : {}), entries: { ...out.entries } }; changed = true; }
    out.entries[no] = { round: Number.isFinite(n.round) ? n.round : null, actor: typeof n.actor === "string" ? n.actor : null, undone,
      rows: rows.map((r) => ({ target: r.target, ...(typeof r.hit === "boolean" ? { hit: r.hit } : {}), ...(Number.isFinite(r.taken) ? { taken: Math.max(0, r.taken) } : {}), ...(r.stress ? { stress: 1 } : {}) })) };
  }
  if (changed) { const keys = Object.keys(out.entries); if (keys.length > TALLY_MAX) for (const k of keys.sort((a, b) => a - b).slice(0, keys.length - TALLY_MAX)) delete out.entries[k]; }
  return out;
}
/** S085: a tally read back from this device's storage, or null. It keeps its fight's tag: a tally without one would be taken for the
    fight that starts next on the same Combat (tallyAdd), and its round and fight cards would count the actions of the fight before. */
export function tallyOf(raw, combatId) {
  if (!raw || typeof raw !== "object" || raw.combat !== combatId || !raw.entries || typeof raw.entries !== "object" || Array.isArray(raw.entries)) return null;
  return { combat: raw.combat, ...(typeof raw.fight === "string" && raw.fight ? { fight: raw.fight } : {}), entries: raw.entries };
}
/** per combatant what it did and what was done to it, in `round` (null: the whole fight) -> [{ id, dealt, taken, stress, attacks, hits }] */
export function totals(tally, round = null) {
  const by = new Map(), row = (id) => { if (!by.has(id)) by.set(id, { id, dealt: 0, taken: 0, stress: 0, attacks: 0, hits: 0 }); return by.get(id); };
  for (const e of Object.values(tally?.entries ?? {})) {
    if (e.undone || (round !== null && e.round !== round)) continue;
    for (const r of e.rows) {
      const n = Number.isFinite(r.taken) ? r.taken : 0, tg = row(r.target);
      if (r.stress) tg.stress += n; else tg.taken += n;
      if (e.actor) { const a = row(e.actor); a.dealt += n; if (typeof r.hit === "boolean") { a.attacks++; if (r.hit) a.hits++; } }
    }
  }
  return [...by.values()];
}
export const roundsOf = (tally) => [...new Set(Object.values(tally?.entries ?? {}).filter((e) => !e.undone && Number.isFinite(e.round)).map((e) => e.round))].sort((a, b) => a - b);
export const SUM_ROWS = 8;
const OUT = ["dead", "unconscious", "broken"];
/** The card. who(id) -> { name, img, mine } | null: null for somebody this user's view does not hold (the row is then left out, so a
    summary can name nobody the fight itself did not show). statuses = the view's (who lies broken now). -> null when there is nothing to say */
function card(tally, round, who, statuses, t, head) {
  const all = totals(tally, round).map((r) => ({ ...r, c: who(r.id) })).filter((r) => r.c);
  if (!all.length) return null;
  const rows = all.sort((a, b) => Number(!!b.c.mine) - Number(!!a.c.mine) || b.dealt - a.dealt || b.taken + b.stress - (a.taken + a.stress) || String(a.c.name).localeCompare(String(b.c.name))).map((r) => {
    const out = OUT.find((s) => (statuses?.[r.id] ?? []).some((x) => x.id === s)) ?? null;
    const chips = [r.dealt > 0 ? { id: "dealt", n: String(r.dealt), tip: t("ITAC.sum.dealt", { n: r.dealt }) } : null, r.attacks > 0 ? { id: "hits", n: `${r.hits}/${r.attacks}`, tip: t("ITAC.sum.hits", { hits: r.hits, n: r.attacks }) } : null,
      r.taken > 0 ? { id: "taken", n: String(r.taken), tip: t("ITAC.sum.taken", { n: r.taken }) } : null, r.stress > 0 ? { id: "stress", n: String(r.stress), tip: t("ITAC.sum.stress", { n: r.stress }) } : null].filter(Boolean);
    return { id: r.id, name: r.c.name, img: r.c.img ?? null, mine: !!r.c.mine, chips, out: out ? { id: out, tip: t(`ITAC.status.${out}`, {}, out) } : null,
      say: [r.c.name, ...chips.map((c) => c.tip), out ? t(`ITAC.status.${out}`, {}, out) : null].filter(Boolean).join(". ") };
  }).filter((r) => r.chips.length);      /* somebody an action only named (no roll against, nothing lost) has no line */
  if (!rows.length) return null;
  const quiet = rows.every((r) => !r.chips.some((c) => c.id !== "hits"));
  return { ...head, rows: rows.slice(0, SUM_ROWS), more: rows.length > SUM_ROWS ? t("ITAC.sum.more", { n: rows.length - SUM_ROWS }) : null, quiet: quiet ? t("ITAC.sum.quiet") : null, close: t("ITAC.sum.close") };
}
export const roundCard = (tally, round, who, statuses, t) => card(tally, round, who, statuses, t, { id: `r:${tally?.combat ?? ""}:${round}`, kind: "round", title: t("ITAC.sum.round", { n: round }), sub: t("ITAC.sum.round.sub") });
/* the fight s card says neither "the fight is over" nor after how many rounds: the banner over the map says both (U52) */
/** U130: the fight a summary card belongs to (its id: "f:<combat>" or "r:<combat>:<round>"), or null */
export const cardFight = (card) => { const m = /^[fr]:([^:]+)/.exec(String(card?.id ?? "")); return m ? m[1] : null; };
/** FXP (D161): a fight started again on the same Combat (a stop and a start, a restart): the summary of the fight before (its fight card,
    shown when it stopped) does not stand over the new one. -> whether that card goes now */
export const sumStale = (card, combatId, view) => /^f:/.test(String(card?.id ?? "")) && cardFight(card) === String(combatId ?? "") && !!view && !viewOver(view) && Number(view.round) >= 1;
export const fightCard = (tally, who, statuses, t) => card(tally, null, who, statuses, t, { id: `f:${tally?.combat ?? ""}`, kind: "fight", title: t("ITAC.sum.fight"), sub: t("ITAC.sum.round.sub") });

/* D131: a fight's summary is shown ONCE per device. The fights already summed up are kept (ids, newest last, at most DONE_MAX); a fight
   that is over (its scene ended, the GM stopped it, its combat was deleted) gives its card the first time one of these is seen and never
   again: not when the stopped fight's combat is deleted later, not after a reload, not when its news is still in a state that stays. */
export const DONE_MAX = 20;
export const doneOf = (raw) => (Array.isArray(raw) ? raw.filter((x) => typeof x === "string" && x).slice(-DONE_MAX) : []);
export const isDone = (done, combatId) => doneOf(done).includes(String(combatId ?? ""));
/** a fight that runs again (the GM restarted the same combat, or took the end of the scene back) is no longer summed up */
export const doneLive = (done, combatId, view) => (view && !viewOver(view) && isDone(done, combatId) ? doneOf(done).filter((x) => x !== String(combatId)) : doneOf(done));
export const doneAdd = (done, combatId) => (combatId ? doneOf([...doneOf(done).filter((x) => x !== combatId), String(combatId)]) : doneOf(done));
/** is the fight of this view over (the rest after the scene: phase "sceneEnd")? */
export const viewOver = (view) => view?.phase === "sceneEnd";
/** the tally to keep for this fight now: none for a fight already summed up */
export const tallyFor = (tally, combatId, news, done) => (isDone(done, combatId) ? null : tallyAdd(tally, combatId, news));
/** the fight is over now: -> { card: whether its card is due (once), done: the new list } */
export const fightOver = (tally, combatId, done) => ({ card: !!tally && tally.combat === combatId && !isDone(done, combatId), done: doneAdd(done, combatId) });

/* ------------------------------------------------------------------ U58: the two sounds */
/** `now` = { turn: [ids of this user's characters whose turn it is], asks: [ids of what the table waits for from this user] }.
    A sound is due only for something that was not there a moment ago, and never at the first look (a reload in the middle of a turn
    is not a turn that begins). "Your turn" wins over "the table waits" when both come at once. -> { cue, next } */
export function cues(prev, now) {
  const next = { turn: [...new Set(now?.turn ?? [])], asks: [...new Set(now?.asks ?? [])] };
  if (!prev) return { cue: null, next };
  const cue = next.turn.some((id) => !prev.turn.includes(id)) ? "turn" : next.asks.some((id) => !prev.asks.includes(id)) ? "wait" : null;
  return { cue, next };
}
/** What the table waits for from this user, from the dock's model (desk-pure.playerModel) or the desk's (staff: the cards).
    The dice of the user's OWN action on the user's own turn are not a wait: the user has just asked for them. */
export function asksOf(model, me, staff, cards = null) {
  const out = [];
  if (staff) for (const c of cards ?? []) out.push(`c:${c.id}`);
  else for (const p of model?.prompts ?? []) out.push(`p:${p.id}`);
  const mine = new Set((model?.bars ?? []).map((b) => b.combatant));
  for (const r of model?.rolls ?? []) if (!staff && r.state !== "done" && (r.users ?? []).includes(me) && !(mine.has(r.actor) && r.who === r.actor)) out.push(`r:${r.inst}:${r.key}`);
  return out;
}
export const SOUNDS = Object.freeze({ turn: "sounds/combat/epic-turn-1hit.ogg", wait: "sounds/notify.wav" });      // both ship with Foundry itself (its public/sounds folder)

/* ------------------------------------------------------------------ U53: first-fight hints */
export const HINTS = Object.freeze(["push", "slots", "speed"]);      // in the order they are tried: what is in front of the user now comes first
/** the hint to show over the dock now: the first one not seen yet whose thing is on screen.
    slots: the user's own turn, the bar open; speed: the same, once the slots were explained; push: a roll of the user that may be pushed.
    -> null | { id, text, close } (U132: the hint hangs at the top, far from the bar: its words carry the marks they are about)
    U186 (UX review 2): the hints speak to a player about the player's own turn ("Your turn. Each round you have..."); a GM seat (staff)
    runs NPCs, and got them at every NPC turn: none there. */
export function hintOf(data, seen = [], t, staff = false) {
  if (!data?.show || staff) return null;
  const been = new Set(seen), mine = !!data.onTurn && !data.rest && !data.out;
  const pushable = [...(data.rolls ?? []), ...(data.panel?.kind === "mine" ? data.panel.rolls ?? [] : [])].some((r) => r.state === "push" && (r.buttons ?? []).some((b) => b.id === "push"));
  const on = { push: pushable, slots: mine && (data.slots ?? []).length > 0, speed: mine && been.has("slots") && (data.groups ?? []).length > 0 };
  const id = HINTS.find((h) => on[h] && !been.has(h));
  return id ? { id, text: t(`ITAC.hint.${id}`), close: t("ITAC.hint.close") } : null;
}
/** U186 / U192: whether a hint may still come for this seat (a player seat with a hint not seen yet): only then does the frame keep the
    hint's place at the band's right end (slots-pure frame f.hints); a GM seat, or a player who has seen them all, gets the whole band for
    the line and the questions. */
export const hintsLeft = (seen = [], staff = false) => !staff && HINTS.some((h) => !(seen ?? []).includes(h));
/** A hint is gone once the user has used the thing: `shown` = the hint on screen at the last draw, `data` / `own` = the dock now.
    slots: a slot is spent; speed: an action is armed or a list is open; push: the roll that could be pushed is settled. -> [ids] */
export function hintsUsed(shown, data, own = {}) {
  if (!shown) return [];
  if (shown === "slots") return (data?.slots ?? []).some((s) => s.state === "used") ? ["slots"] : [];
  if (shown === "speed") return own.armed || own.mode ? ["speed"] : [];
  if (shown === "push") return hintOf(data, [], (k) => k)?.id === "push" ? [] : ["push"];
  return [];
}
