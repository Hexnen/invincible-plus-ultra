/* Tactical combat, the surfaces: EVERYTHING WAITS FOR THE DICE (ANSC; the user 2026-11-12 on U10-9 + UXB-7 + FXJ-3 + SEAM-1:
   «Wszystko czeka, także liczby nad żetonem»). The engine knows what a roll came to the moment its chat message is made; the 3D dice
   of Dice So Nice then roll on every screen for seconds. The card, the news line, the own roll rows, the camera's result shot and the
   turn that ends by itself already waited for the dice on this client (D128, FXN, FXJ, SEAM, FXP: news-pure.mjs). The rest of what
   shows a result waits the same way here: the numbers over the tokens, the quiet camera cues of a result, the dice a new roll request
   throws, a new roll row and the "waiting for" pieces it brings, the sound of a new question, the initiative bar's Health and Resolve,
   the challenges HUD's rating and time, the GM desk's rows (the sixes, hit or miss, the journal, the unit panel, the scene tab, an NPC
   out of Resolve), the chase panel and the state marks on the map.
   ONE RULE for all of them: while the 3D dice of a roll roll on THIS client (Dice So Nice's own flag on the message, at most HOLD_MS,
   so a stuck flag never keeps anything from the table) what was shown stays shown, what is new waits, and once they have landed
   everything is shown as it is. With 3D dice off or absent on this client the flag is never set: nothing waits.
   Pure: no Foundry, no DOM. The Foundry side is ui/dicegate.mjs; node checks: scripts/tactics/check-ansc.mjs. */
import { HOLD_MS } from "./news-pure.mjs";

export { HOLD_MS };
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
/** what a value says, for "did it change": functions (a button's request) say nothing */
export const sig = (v) => { try { return JSON.stringify(v) ?? "null"; } catch { return String(v); } };

/** Do the dice hold the surfaces now? busy = 3D dice roll on this client, since = when this client first saw them rolling (null: not
    yet) -> { on, since } (since is kept while they roll; past HOLD_MS `on` is false however long the flag stays) */
export function diceHolds(busy, since, now) {
  if (!busy) return { on: false, since: null };
  const s = Number.isFinite(since) ? since : Number(now) || 0;
  return { on: (Number(now) || 0) - s <= HOLD_MS, since: s };
}

/** A map { key: value } (the view's statuses, its prompts): while `on`, a key shown before keeps what it showed (also when it is gone or
    changed), a new key waits. memo = what was shown last ({ key: value } | null) -> { obj, memo, held } */
export function holdKeys(memo, obj, on) {
  const now = isObj(obj) ? obj : {};
  if (!on || !isObj(memo)) return { obj, memo: { ...now }, held: false };
  const shown = { ...memo };
  const held = sig(Object.keys(shown).sort().map((k) => [k, shown[k]])) !== sig(Object.keys(now).sort().map((k) => [k, now[k]]));
  return { obj: held ? shown : obj, memo: shown, held };
}

/** A list of rows with an `id`: while `on`, a row shown before keeps the `fields` it showed (fields null: the whole row), a new row waits
    (`hideNew`) or shows, a row gone since stays where it stood (`keepGone`). memo = { order: [id], by: { id: row } } | null
    -> { items, memo, held } */
export function holdById(memo, items, fields, on, { keepGone = false, hideNew = false } = {}) {
  const list = Array.isArray(items) ? items : [];
  const remember = (rows) => ({ order: rows.map((r) => r?.id), by: Object.fromEntries(rows.filter((r) => r?.id != null).map((r) => [r.id, r])) });
  if (!on || !memo?.by) return { items, memo: remember(list), held: false };
  const out = [];
  for (const r of list) {
    const p = r?.id != null ? memo.by[r.id] : null;
    if (!p) { if (!hideNew || r?.id == null) out.push(r); continue; }
    if (!fields) { out.push(p); continue; }
    const row = { ...r };
    for (const f of fields) { if (f in p) row[f] = p[f]; else delete row[f]; }
    out.push(row);
  }
  if (keepGone) {
    const now = new Set(list.map((r) => r?.id));
    memo.order.forEach((id, i) => { if (id != null && !now.has(id) && memo.by[id]) out.splice(Math.min(i, out.length), 0, memo.by[id]); });
  }
  const held = sig(out) !== sig(list);
  return { items: held ? out : items, memo: remember(held ? out : list), held };
}

/** One thing as a whole (the chase panel, the desk's scene tab): while `on` what was shown stays. memo = { v } | null -> { value, memo, held } */
export function holdWhole(memo, value, on) {
  if (!on || !memo || !("v" in memo)) return { value, memo: { v: value }, held: false };
  const held = sig(memo.v) !== sig(value);
  return { value: held ? memo.v : value, memo: held ? memo : { v: value }, held };
}

/** The pieces of a "waiting for" strip (model-pure waitingData rows: `what` with the `ids` they are about): while `on` a piece not shown
    before waits (a roll asked because of the result: "Waiting for Kid: injury"); a row left with nothing goes. A piece without an id
    stays. memo = [ids shown] | null -> { rows, memo, held } */
export function holdWaitNew(memo, rows, on) {
  const list = Array.isArray(rows) ? rows : [];
  const idsOf = (rs) => rs.flatMap((r) => (Array.isArray(r?.ids) ? r.ids : [])).filter((id) => id != null);
  if (!on || !Array.isArray(memo)) return { rows, memo: idsOf(list), held: false };
  const seen = new Set(memo), out = [];
  let held = false;
  for (const r of list) {
    if (!Array.isArray(r?.ids)) { out.push(r); continue; }
    const at = r.ids.map((id, i) => (id == null || seen.has(id) ? i : -1)).filter((i) => i >= 0);
    if (at.length === r.ids.length) { out.push(r); continue; }
    held = true;
    if (at.length) out.push({ ...r, what: at.map((i) => r.what?.[i]), ids: at.map((i) => r.ids[i]) });
  }
  return { rows: held ? out : rows, memo: [...seen, ...idsOf(out)].filter((x, i, a) => a.indexOf(x) === i), held };
}

/** The dock's roll rows (model-pure rollsData: `data.rolls`, and the armed panel's `panel.rolls` of the own action): while `on`, a roll
    row this client has not shown yet waits (a roll asked because of what the dice came to: the injury of the one put down). Rows already
    shown are news-pure holdRollsIn's (a result reads as "rolling"); a new row that already reads "rolling" (its own dice in the air)
    shows. memo = [ids shown] | null -> { memo, held, hidden: [ids] }; `data`
    is changed in place, as holdRollsIn does */
export function holdNewRolls(memo, data, on) {
  const seen = new Set(Array.isArray(memo) ? memo : []), hidden = [], shown = [];
  const first = !Array.isArray(memo);
  const pass = (rows) => (Array.isArray(rows) ? rows.filter((r) => {
    if (!r || r.id == null) return true;
    if (on && !first && !seen.has(r.id) && r.state === "owed") { hidden.push(r.id); return false; }
    shown.push(r.id); return true;
  }) : rows);
  if (data?.show !== false && Array.isArray(data?.rolls)) data.rolls = pass(data.rolls);
  if (data?.panel?.kind === "mine" && Array.isArray(data.panel.rolls)) data.panel.rolls = pass(data.panel.rolls);
  const keep = on ? [...seen, ...shown] : shown;
  return { memo: keep.filter((x, i, a) => a.indexOf(x) === i).slice(-200), held: hidden.length > 0, hidden };
}

/** What the sounds hear (feedback-pure asksOf: the "the table waits for you" cue): the model of this seat without the questions and
    the rolls that wait for the dice, so the sound comes when the card does. held = ids of the questions held back (prompts / desk
    cards), hiddenRolls = ids "inst:key" of roll rows held back -> { model, cards } */
export function heldAsks(model, cards, held, hiddenRolls) {
  const s = new Set(Array.isArray(held) ? held : []), h = new Set(Array.isArray(hiddenRolls) ? hiddenRolls : []);
  if (!s.size && !h.size) return { model, cards };
  const m = isObj(model) ? { ...model, prompts: (model.prompts ?? []).filter((p) => !s.has(p.id)), rolls: (model.rolls ?? []).filter((r) => !h.has(`${r.inst}:${r.key}`)) } : model;
  return { model: m, cards: Array.isArray(cards) ? cards.filter((c) => !s.has(c.id)) : cards };
}

/** The GM desk (model-pure deskData) while the dice roll: the rows in progress keep their dice, hit or miss, step and text (a row that
    closed meanwhile stays), the journal shows no new line, the unit panel (the kit tab's head) keeps its Health, states and last lines,
    the scene tab (chase, vehicles, challenges) stays as it was, an NPC's "out of Resolve" note waits. memo = { stack, journal, unit, scene,
    npcs } | null -> { desk, memo, held } */
export const STACK_HELD = Object.freeze(["rolls", "outcomes", "step", "text"]);
export const UNIT_HELD = Object.freeze(["vitals", "states", "last", "group", "zone"]);
export function holdDeskResults(memo, desk, on) {
  if (!isObj(desk) || desk.show === false) return { desk, memo: memo ?? null, held: false };
  const m = memo ?? {}, out = { ...desk };
  let held = false;
  const st = holdById(m.stack, desk.stack, STACK_HELD, on && !!m.stack, { keepGone: true });
  if (st.held) { out.stack = st.items; held = true; }
  /* the journal: rounds of rows; a row not shown before waits, a row shown keeps what it said */
  const rows = (Array.isArray(desk.journal) ? desk.journal : []).flatMap((r) => r.rows ?? []);
  const jr = holdById(m.journal, rows, null, on && !!m.journal, { hideNew: true });
  if (jr.held) {
    const by = new Map((jr.items ?? []).map((r) => [r.id, r]));
    out.journal = desk.journal.map((r) => ({ ...r, rows: (r.rows ?? []).filter((x) => by.has(x.id)).map((x) => by.get(x.id)) })).filter((r) => r.rows.length);
    held = true;
  }
  const unit = out.kit?.unit ? [out.kit.unit] : [];
  const un = holdById(m.unit, unit, UNIT_HELD, on && !!m.unit);
  if (un.held) { out.kit = { ...out.kit, unit: un.items[0] }; held = true; }
  const sc = holdWhole(m.scene, desk.scene ?? null, on && !!m.scene && desk.tab === "scene" && m.sceneTab === "scene");
  if (sc.held) { out.scene = sc.value; held = true; }
  const np = holdById(m.npcs, desk.npcs, ["note"], on && !!m.npcs);
  if (np.held) { out.npcs = np.items; held = true; }
  return { desk: held ? out : desk, memo: { stack: st.memo, journal: jr.memo, unit: un.memo, scene: sc.memo, sceneTab: desk.tab, npcs: np.memo }, held };
}

/** The initiative bar's tiles (combat/bar.mjs read()) and the challenges HUD's cards (challenges/main.mjs read()): the numbers a tile
    shows. Held only in a tactical fight (the engine writes a result into the sheets at once; elsewhere a person does, after the dice). */
export const BAR_HELD = Object.freeze(["hp", "rs", "showHp", "showRs", "defeated"]);
export const HUD_HELD = Object.freeze(["cr", "crMax", "tl", "tlMax"]);
/** The events whose quiet camera cue (not a staged shot) says what a roll came to */
export const RESULT_EVENTS = Object.freeze(["outcome", "damage", "broken", "forcedMove", "crit"]);
export const isResultEvent = (ev) => !!ev && RESULT_EVENTS.includes(ev.type);
