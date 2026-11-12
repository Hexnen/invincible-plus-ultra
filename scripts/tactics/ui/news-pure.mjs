/* Tactical combat, the surfaces: WHAT THE NEWS LINE SAYS AND FOR HOW LONG (UXB: U141, D128). NO Foundry or browser globals (node-tested
   in check-uxb.mjs). The engine writes one line per action that closed (engine-pure newsOf); a player's view hands them over
   (view-pure viewFor). This file decides which of them still stand and which belong together:
     newsWindow(prev, { combat, member, newest })   the turns this client has seen. A line stands through the turn it was written in
                                                    and the turn after it; then it goes (into nothing: the journal keeps the fight).
                                                    `member` = whose turn this user's view shows (null between turns, or while somebody
                                                    concealed from the user acts: that is no new turn for this user). -> { combat,
                                                    member, from, mark } : lines numbered above `from` stand
     groups(list)                                   the lines that are told as ONE: an action with the counterattack that answered it
                                                    (the counter closes first, so its line came first and was buried under the attack's
                                                    miss), and the same hazard on several characters at once (one fire, one line).
                                                    -> [[line, ...]] in order, the head first
     merged(group)                                  a hazard group as one line with every character's row */
/* BH4-1: a line's id is "n<seq>_<fight>" since H3-1 (state-pure idOf). Its number is the seq ALONE: the digits of the fight's tag
   glued behind it ("n5_mh3k9x01a" read as 53901) broke "the next line" (sameHazard: 53901 + 1 is not 63901, so one fire on three people
   stayed three lines) and made the numbers of two fights on one Combat incomparable. The tag says which fight a line is of. */
const idStr = (x) => String((x && typeof x === "object" ? x.id : x) ?? "");
export const newsNo = (n) => { const m = /^[A-Za-z]*(\d+)/.exec(idStr(n)); return m ? Number(m[1]) || 0 : 0; };
export const fightOf = (n) => { const s = idStr(n), i = s.indexOf("_"); return i >= 0 ? s.slice(i + 1) : ""; };
export const newest = (list) => (list ?? []).reduce((m, n) => Math.max(m, newsNo(n)), 0);
/** the fight the lines of a view are of (the newest line's tag; "" when the ids carry none) */
export const fightOfList = (list) => fightOf((list ?? []).reduce((a, n) => (n && typeof n === "object" && (!a || newsNo(n) >= newsNo(a)) ? n : a), null));
/** FXN (bug hunt 4, suspicion 3): the fight a view is of: its own tag (the state's `fight`, in a player's view too), else its lines' */
export const fightNow = (view) => (typeof view?.fight === "string" && view.fight ? view.fight : fightOfList(view?.news));
/** FXN (bug hunt 4, suspicion 2): the sidebar folds once per FIGHT (U150), not once per Combat: a fight started again on the same
    Combat (a new tag) folds it again */
export const foldKey = (combatId, view) => `${combatId ?? ""}:${fightNow(view)}`;
/** BH4-1: a mark the surface keeps ("put away up to here") is "<fight>:<seq>": it counts only for the lines of that same fight (a fight
    started again on the same Combat counts its lines from 1 again). A bare number (ids without a tag) counts as it is. */
export const markOf = (fight, n) => { const k = Math.max(0, Math.trunc(Number(n) || 0)); return fight ? `${fight}:${k}` : k; };
export function seenNo(mark, fight) {
  if (typeof mark === "number") return Number.isFinite(mark) ? mark : 0;
  const m = /^([a-z0-9]*):(\d+)$/.exec(String(mark ?? ""));
  if (!m) return Number(mark) || 0;
  return m[1] === (fight ?? "") ? Number(m[2]) || 0 : 0;
}

/** FXN (ver11): whose turn a view shows, for the window. The turn of somebody concealed from this user (the view is in its turns, no
    current member: view-pure hides the card, the slot before it already reads "done") IS a turn here too: a line made two turns ago no
    longer stands through it (ver11: Eve's line still stood on Kid's seat after Immortal's move and through the unseen turret's turn).
    It names nobody: "@unseen:<n>", n = the slots done so far (two concealed turns in a row are two turns). null between turns. */
export function memberOf(view) {
  const m = view?.init?.curMember;
  if (typeof m === "string" && m) return m;
  if (view?.phase !== "turns") return null;
  const done = (Array.isArray(view?.init?.slots) ? view.init.slots : []).filter((s) => s?.state === "done").length;
  return `@unseen:${done}`;
}
/** prev = the last window (or null); now = { combat, member, newest }. A first look (a reload in the middle of a fight) keeps only the
    newest line: what came before it is not known to belong to this turn or the last. */
export function newsWindow(prev, now) {
  const combat = now?.combat ?? null, member = typeof now?.member === "string" && now.member ? now.member : null, top = Number(now?.newest) || 0;
  const fight = typeof now?.fight === "string" ? now.fight : "", round = Number.isFinite(now?.round) ? now.round : null;
  if (!prev || prev.combat !== combat) return { combat, fight, round, member, from: Math.max(0, top - 1), mark: Math.max(0, top - 1) };      // (it counts as of this turn: it stands through the next one too)
  /* BH4-1: the GM started the fight again on the same Combat: its lines count from 1 again, and every one of them is new to this client */
  if ((prev.fight ?? "") !== fight) return { combat, fight, round, member, from: 0, mark: 0 };
  /* BH4-2: the same member again in the NEXT round (last of one round, first of the next: the cards are dealt again) is a new turn too */
  const again = !!member && member === prev.member && round !== null && prev.round != null && round !== prev.round;
  if (!member || (member === prev.member && !again)) return prev.round == null && round !== null && member ? { ...prev, round } : prev;
  /* a new turn: the lines of the turn that just ended (and of the time between, a round's start) stand on; the ones before it go */
  return { combat, fight, round, member, from: prev.mark, mark: top };
}

const sameHazard = (a, b) => a.kind === "action" && b.kind === "action" && a.flow === "hazard" && b.flow === "hazard" && !a.actor && !b.actor && a.hazard && a.hazard === b.hazard
  && (a.hzCause ?? null) === (b.hzCause ?? null) && a.round === b.round && !a.undone === !b.undone && fightOf(a) === fightOf(b) && newsNo(b) === newsNo(a) + 1;
/** list in the order written -> groups in the order told; a group's head is the line that names it */
export function groups(list) {
  const lines = (list ?? []).filter((n) => n && typeof n === "object");
  const kids = new Map(), heads = [];
  const parentOf = (n) => (n.kind === "action" && typeof n.parent === "string" ? lines.find((p) => p !== n && p.kind === "action" && p.inst === n.parent && newsNo(p) > newsNo(n)) : null);
  /* the line that names the whole chain (a fire's spread set off a fire that burnt two people: three lines, one chain, one root) */
  const rootOf = (n) => { let r = parentOf(n), seen = 0; while (r && seen++ < 12) { const up = parentOf(r); if (!up) break; r = up; } return r; };
  for (const n of lines) { const p = rootOf(n); if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); } else heads.push(n); }
  const out = [];
  for (const n of heads) {
    const prev = out[out.length - 1], last = prev?.[prev.length - 1];
    if (prev && prev.length >= 1 && prev.every((x) => x.flow === "hazard") && sameHazard(last, n)) { prev.push(n); continue; }
    out.push([n, ...(kids.get(n) ?? [])]);
  }
  return out;
}
/* D128: WHILE THE DICE ROLL. The engine knows what a roll came to the moment its message is made; the 3D dice then roll for seconds.
   What follows from the result (the counterattack card, a new card, the news line) waits until the dice of the rolls in flight have
   landed: a card already shown stays, a new one is held, the line keeps saying what it said. At most HOLD_MS (a stuck flag must never
   keep a card from the table). prev = what was shown last time ({ prompts, cards, news, since }), now = { prompts, cards, news, at },
   busy = dice roll on this client -> { prompts, cards, news, since, held } */
export const HOLD_MS = 9000;
export function diceHold(prev, now, busy) {
  const at = Number(now?.at) || 0, since = busy ? (prev?.since ?? at) : null;
  const ids = (x) => (Array.isArray(x) ? x : []);
  if (!busy || !prev || at - since > HOLD_MS) return { prompts: ids(now?.prompts), cards: ids(now?.cards), news: now?.news ?? null, since, held: false };
  const keep = (list, was) => ids(list).filter((id) => ids(was).includes(id));
  const prompts = keep(now?.prompts, prev.prompts), cards = keep(now?.cards, prev.cards);
  const news = (now?.news?.id ?? null) === (prev.news?.id ?? null) ? now?.news ?? null : prev.news ?? null;
  const held = prompts.length < ids(now?.prompts).length || cards.length < ids(now?.cards).length || news !== (now?.news ?? null);
  return { prompts, cards, news, since, held };
}
/* SEAM (uxb D128 x uxa U140): the desk without the cards held back while the dice roll is counted without them too (its badge, and
   `igd-busy`, which keeps an idle desk from stepping back while the user aims at the map). deskD = model-pure deskData, keep = card ids */
/* FXN (D132): ... and every other place that counts or names them: the badge of the "Now" tab (tabs[0].n), the folded desk's "expand"
   words, and the "waiting for" strip (a held card is not named there before it shows). `expand(n)` = the folded desk's words for n. */
export function holdDesk(deskD, keep, expand = null) {
  if (!deskD || !Array.isArray(deskD.cards)) return deskD;
  const cards = deskD.cards.filter((c) => (keep ?? []).includes(c.id)), gone = deskD.cards.length - cards.length;
  if (!gone) return deskD;
  const count = Math.max(0, (Number(deskD.count) || 0) - gone), held = deskD.cards.filter((c) => !cards.includes(c)).map((c) => c.id);
  return { ...deskD, cards, count,
    ...(Array.isArray(deskD.tabs) ? { tabs: deskD.tabs.map((x) => (x.id === "now" ? { ...x, n: count } : x)) } : {}),
    ...(Array.isArray(deskD.waiting) ? { waiting: holdWaiting(deskD.waiting, held) } : {}),
    ...(deskD.labels && typeof expand === "function" ? { labels: { ...deskD.labels, expand: expand(count) } } : {}) };
}
/** FXN (D132): the rows of a "waiting for" strip (model-pure waitingData: `what` with the `ids` they are about) without the pieces about
    the held ids; a row left with nothing goes. Rows without `ids` stay as they are. */
export function holdWaiting(rows, held) {
  const out = [], h = new Set(Array.isArray(held) ? held : []);
  if (!h.size || !Array.isArray(rows)) return rows;
  for (const r of rows) {
    if (!Array.isArray(r?.ids)) { out.push(r); continue; }
    const at = r.ids.map((id, i) => (h.has(id) ? -1 : i)).filter((i) => i >= 0);
    if (at.length === r.ids.length) { out.push(r); continue; }
    if (at.length) out.push({ ...r, what: at.map((i) => r.what[i]), ids: at.map((i) => r.ids[i]) });
  }
  return out;
}
/* SEAM (uxc U144 x uxb D128): a turn with nothing left passes by itself 1.5 s later; while the 3D dice of a roll still roll on this
   client (the result held back) it waits for them, as the cards and the line do: the button is the plain End turn until they land (one
   click still ends it), then the 1.5 s run from there. At most HOLD_MS (a stuck dice flag never keeps the turn). dice = { busy, since,
   at }, plain = { label, tip } -> end, with `dice: 1` while it waits */
export function endWhileDice(end, dice, plain) {
  if (!end?.auto || !dice?.busy) return end;
  const since = Number.isFinite(dice.since) ? dice.since : Number(dice.at) || 0;
  if ((Number(dice.at) || 0) - since > HOLD_MS) return end;
  return { ...end, auto: false, label: plain?.label ?? end.label, tip: plain?.tip ?? end.tip, dice: 1 };
}
/* FXP (U178): End turn PRESSED while the 3D dice of a roll still roll on this client (a push thrown a moment before) is sent when they
   land: the turn passing at once brought the next turn's banner, the camera pan and the news line over the flying dice (the auto end
   already waits: endWhileDice). At most HOLD_MS (a stuck dice flag never keeps the turn). req = the request, dice = { busy, since, at } */
export function endAfterDice(req, dice) {
  if (req?.op !== "endTurn" || !dice?.busy) return false;
  const since = Number.isFinite(dice.since) ? dice.since : Number(dice.at) || 0;
  return (Number(dice.at) || 0) - since <= HOLD_MS;
}
/* FXN (U162): THE OWN ROLL'S RESULT WAITS FOR ITS DICE. The line, the cards and the auto end already wait while 3D dice roll (D128,
   SEAM); the roll rows of this user (the dock's chips and the armed panel of the own action) did not: the attacker read the sixes and
   got Push / Accept while the dice were in the air. While `on` (dice roll on this client, within HOLD_MS), a row that turned into a
   result since it was last shown (it was owed or rolling, or is new) keeps reading as rolling (the row's own `wait`, model-pure
   rollsData); and in the panel the defences beside it (U146) keep what they said, a new one waits. `data` = model-pure dockData
   (its `rolls`, `panel.rolls`, `panel.opp` are replaced), prev = the last answer -> { rows, opp, held } (what was shown, by id) */
export function holdRollsIn(data, prev, on) {
  const pr = prev?.rows ?? {}, po = prev?.opp ?? {}, rows = {}, opp = {};
  let held = false;
  const one = (r) => {
    if (!r || typeof r !== "object") return r;
    const p = pr[r.id], wait = on && r.state === "push" && r.wait && (!p || p.state === "owed" || p.state === "rolling");
    const shown = wait ? { ...r, ...r.wait } : r;
    if (wait) held = true;
    if (r.id != null) rows[r.id] = { state: shown.state };
    return shown;
  };
  if (data?.show !== false && Array.isArray(data?.rolls)) data.rolls = data.rolls.map(one);
  const panel = data?.panel;
  if (panel?.kind === "mine") {
    if (Array.isArray(panel.rolls)) panel.rolls = panel.rolls.map(one);
    if (Array.isArray(panel.opp)) {
      const list = [];
      for (const o of panel.opp) {
        const p = po[o.id], same = !!p && p.text === o.text;
        if (!on || same) { list.push(o); opp[o.id] = o; continue; }
        held = true;
        if (p) { list.push(p); opp[o.id] = p; }
      }
      panel.opp = list;
    }
  }
  return { rows, opp, held };
}
/* FXN (D133): how long a turn with nothing left stands before it passes by itself. 1.5 s after the last action (U144); a turn that
   STARTED with nothing left (model-pure `end.spent`: the round's actions went before it) stands longer, so its reason on the bar
   (`out` "spent") can be read before it goes. */
export const AUTO_SPENT_MS = 3500;
export const autoDelay = (end, base = 1500) => (end?.spent ? Math.max(AUTO_SPENT_MS, base) : base);
/* FXN (bug hunt 4, suspicion 1): a hero driven from two seats (two owners, or a player and an assistant) passes its empty turn on both;
   the press that comes second is refused because the turn moved on. That refusal of an AUTO press is no news to the seat: not shown. */
export const AUTO_QUIET = Object.freeze(["stale", "notYourTurn", "gone"]);
export const autoQuiet = (error) => AUTO_QUIET.includes(String(error?.code ?? ""));
/** a group of one hazard as ONE line: the head with every character's row (one fire on three people: one line, three rows) */
export function merged(group) {
  if (!group?.length) return [];
  if (group.length > 1 && group.every((x) => x.flow === "hazard")) return [{ ...group[0], id: group[group.length - 1].id, rows: group.flatMap((x) => x.rows ?? []) }];
  /* a head that only carried what it set off (a fire that spread, then burnt somebody): what it did is the news, the head is on the map */
  const told = (x) => (x.rows ?? []).some((r) => typeof r?.hit === "boolean" || Number.isFinite(r?.taken));
  if (group.length > 1 && group[0].kind === "action" && !group[0].actor && !told(group[0]) && group.slice(1).some(told)) {
    const top = group.reduce((a, b) => (newsNo(b) > newsNo(a) ? b : a)).id, out = [];
    for (const x of group.filter((y) => y.actor || told(y))) {
      const same = x.flow === "hazard" && !x.actor ? out.find((o) => o.flow === "hazard" && !o.actor && o.hazard === x.hazard) : null;
      if (same) same.rows = [...(same.rows ?? []), ...(x.rows ?? [])]; else out.push({ ...x, id: top, rows: [...(x.rows ?? [])] });
    }
    return out;
  }
  return group;
}

/** FXU (D192, ver12): the line a chase round left ("Chase round: the chase goes on") speaks of a chase; once the chase is over (the GM ended
    it: "To combat", "Escaped", ...) the end card says how it ended and the line no longer stands (it stood on the players' line after the
    end). While the chase runs the panel tells its rounds (chase-pure.lineTrim). -> true: leave this line out */
export const chaseGone = (n, view) => n?.kind === "action" && n.action === "chaseRound" && !(view?.kind === "chase" && view?.chase && typeof view.chase === "object");
