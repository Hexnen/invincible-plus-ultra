/* Tactical combat, the surfaces: THE CAMERA, the pure part (ledger row U94; spec section 25). NO Foundry globals (node: check-cam.mjs).
   What the camera of ONE client does is worked out on that client from two things only:
     - this user's own VIEW of the fight (view-pure.viewFor: nothing about somebody concealed from this user is in it), and
     - this user's own hand on the dock (the unit chosen, the action armed, the target walked to).
   `look(view, own)` takes down what matters of both; `cues(before, now)` compares two looks and names what happened that the camera
   may answer. A cue names combatants by id; the Foundry side (ui/camera.mjs) hands the tokens this client's canvas draws to the
   map's `frame` (zones-api.md section 38), and the map decides whether and how the view moves (the user's switch, the user's hand,
   the free part of the screen). Nothing here is sent to anybody, and the GM's client works out nothing for a player.

   THE MOMENTS (XCOM: the camera goes to whoever acts; here every user has an own screen and an own turn to wait for, so it goes
   there only when that is off the user's screen, by the least slide, at the user's zoom):
     hand   select   the user chose another unit on the dock            (XCOM: Tab to the next soldier)
            aim      the user walked to a target (Tab, a chip)          (XCOM: the camera swings to the target)
            arm      the user armed Move                                (the unit out from under the bars before the zones are picked)
            ownMove  the user's unit has walked                         (XCOM: the camera follows the soldier)
     turn   asked    a question is put to this user about somebody      (XCOM: the cut to the one who reacts)
            ownTurn  the turn of a unit this user drives starts         (XCOM: the camera centres on the soldier)
            turn     somebody else's turn starts                        (XCOM: the cut to the alien that acts, when it is seen)
            attacked a unit this user drives is the target of an action
            hurt     a unit this user drives got a result (hit, miss)
     all    attack   somebody acts on somebody (the whole table's line)  (XCOM: the action camera)
            move     somebody else walks: where from, then where to
            result   somebody else got a result
            reveal   somebody came into this user's view of the fight   (XCOM: the pod reveal)
   `level`: the least setting of the user's switch at which the cue plays ("turn"; "all"; "off" plays nothing).
   `hand`: the cue answers the user's own act, so the quiet time after the user's own camera move does not stop it.

   THE ACTION CAMERA (ledger row U98; spec section 26), the switch's default setting "action": the moments XCOM gives a shot get one
   here too, out of the map director's shots (zones-api.md section 39). `eventShot` / `cueShot` name the BEAT; the map plays it on
   this client (the view goes there, holds and comes back), or answers that this user's switch is turned down, and then the cue
   above is played instead.
     open     somebody acts on somebody, seen by this user as a watcher   (XCOM: the action camera on the one who fires)
     hit      a blow landed            for every seat that holds the target, the attacker's own included
     miss     it did not
     kill     the target is out        (XCOM: the kill shot)
     reveal   somebody came into this user's view of the fight            (XCOM: the pod reveal)
     move     somebody else walks      (XCOM: the enemy's move is shown)
     close    the exchange is over     (a camera still waiting for the result goes back)
   Never a shot: while the user has an action armed (the map is under the user's hand); an opening for the one who acts (the target
   was chosen on that user's own screen) or for the one whose unit is aimed at (the question is theirs: the quiet cue "attacked");
   an opening whose attacker this view does not hold. A user with a question to answer gets the beats of a result `still`: in
   place, nothing moves. A beat names only combatants this user's look holds, exactly as a cue does. */

const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && x) : []);
export const ORDER = Object.freeze(["select", "aim", "arm", "asked", "ownTurn", "ownMove", "attacked", "hurt", "turn", "attack", "result", "move", "reveal"]);
export const LEVEL = Object.freeze({ select: "turn", aim: "turn", arm: "turn", asked: "turn", ownTurn: "turn", ownMove: "turn", attacked: "turn", hurt: "turn", turn: "turn", attack: "all", result: "all", move: "all", reveal: "all" });
export const HAND = Object.freeze(["select", "aim", "arm", "ownMove"]);

/** Is this prompt put to this user (and not answered)? Staff: the GM's cards. */
function asked(p, own) {
  if (!isObj(p) || p.answered) return false;
  if (own.staff) return p.to === "gm";
  return (isObj(p.to) && Array.isArray(p.to.users) && p.to.users.includes(own.me)) || (!!p.about && own.mine.includes(p.about) && p.to !== "gm");
}

/** What matters of a view and of the user's own dock, for the camera.
    own = { me, staff, mine: [combatants this user drives], who: the dock's unit, sel: the unit the user chose, armed: action id | null, targets: [ids] } */
export function look(view, own = {}) {
  if (!isObj(view)) return null;
  const o = { me: own.me ?? null, staff: own.staff === true, mine: ids(own.mine) };
  const known = Object.keys(view.ledger ?? {}), has = new Set(known), keep = (x) => (typeof x === "string" && has.has(x) ? x : null);
  const asks = {};
  for (const p of Object.values(isObj(view.prompts) ? view.prompts : {})) {
    if (!asked(p, o) || typeof p.id !== "string") continue;
    const about = keep(p.about);
    if (about) asks[p.id] = { about, attacker: keep(p.data?.attacker) };
  }
  const cur = keep(view.init?.curMember);
  return { round: Number.isFinite(view.round) ? view.round : null, cur, known, asks, mine: o.mine.filter((x) => has.has(x)), staff: o.staff,
    who: keep(own.who), sel: keep(own.sel), armed: typeof own.armed === "string" && own.armed ? own.armed : null, targets: ids(own.targets).filter((x) => has.has(x)) };
}

/** What happened between two looks that the camera may answer, the most pressing first.
    -> [{ why, level, hand, focus: combatant, with: [combatants], zone?: key, after?: combatant (wait until it has walked) }] */
export function cues(before, now) {
  if (!now || !before) return [];                                                                   // the first look (joined, reloaded, the fight began): the view stays
  const out = [], mine = new Set(now.mine), add = (why, focus, more = {}) => { if (focus) out.push({ why, level: LEVEL[why], hand: HAND.includes(why), focus, with: [], ...more }); };
  const turned = now.cur !== before.cur || now.round !== before.round;
  /* the user's own hand */
  if (!turned && now.sel && now.sel !== before.sel) add("select", now.sel);
  const fresh = now.armed ? now.targets.filter((x) => !(before.targets ?? []).includes(x)).pop() ?? null : null;      // (several targets: the one just added)
  if (fresh) add("aim", fresh, { with: now.who && now.who !== fresh ? [now.who] : [] });
  if (now.armed === "move" && before.armed !== "move" && now.who) add("arm", now.who);
  /* a question put to this user */
  for (const [id, a] of Object.entries(now.asks)) if (!before.asks?.[id]) add("asked", a.about, { with: a.attacker && a.attacker !== a.about ? [a.attacker] : [] });
  /* the turn */
  if (turned && now.cur) add(mine.has(now.cur) ? "ownTurn" : "turn", now.cur);
  /* somebody new in this user's view of the fight */
  const knew = new Set(before.known);
  if (before.known.length) for (const x of now.known) if (!knew.has(x) && !mine.has(x)) add("reveal", x);
  /* while the user aims (an action armed on the dock) the map is under the user's hand: only the hand's own cues */
  const list = now.armed ? out.filter((c) => c.hand) : out;
  return list.sort((a, b) => ORDER.indexOf(a.why) - ORDER.indexOf(b.why));
}
/** What an EVENT of the fight (spec 16) gives the camera on a client whose look is `now`. A player's client hears the public stream
    (nothing in it about anybody concealed from anybody); whatever it names is asked of this user's own look again: a combatant this
    view does not hold gives no cue and is in none. -> cue | null */
const cid = (x) => (typeof x === "string" ? x : isObj(x) && typeof x.combatant === "string" ? x.combatant : null);
export function eventCue(ev, now) {
  if (!isObj(ev) || !now) return null;
  const has = new Set(now.known), mine = new Set(now.mine), keep = (x) => { const id = cid(x); return id && has.has(id) ? id : null; };
  const mk = (why, focus, more = {}) => (focus && (!now.armed || HAND.includes(why)) ? { why, level: LEVEL[why], hand: HAND.includes(why), focus, with: [], ...more } : null);      // (while the user aims: only the hand's own)
  const actor = keep(ev.actor);
  if (ev.actor != null && !actor) return null;                                                      // done by somebody this view does not hold
  if (ev.type === "actionDeclared") {
    const to = typeof ev.decl?.to === "string" && ev.decl.to ? ev.decl.to : null;
    if (actor && to && (ev.decl?.mode || ev.decl?.action === "move")) return mk(mine.has(actor) ? "ownMove" : "move", actor, { zone: to, after: actor });
    const targets = ids((ev.targets ?? []).map(cid)).filter((x) => has.has(x) && x !== actor).slice(0, 12);
    if (!targets.length || (actor && mine.has(actor))) return null;                                 // the user's own action: the target was chosen on the user's own screen
    const hit = targets.find((x) => mine.has(x)) ?? null, focus = hit ?? targets[0];
    return mk(hit ? "attacked" : "attack", focus, { with: [...targets.filter((x) => x !== focus), ...(actor ? [actor] : [])] });
  }
  if (ev.type === "outcome" || ev.type === "damage" || ev.type === "broken" || ev.type === "forcedMove") {
    const target = keep(ev.target);
    if (!target || (actor && mine.has(actor))) return null;                                        // the result of the user's own action lands where the user aimed
    return mk(mine.has(target) ? "hurt" : "result", target, { after: target });
  }
  return null;
}
/** U98: the shot an EVENT of the fight asks for on a client whose look is `now` -> { beat, key, focus, with, zone?, still } | null.
    `key` is the exchange (the engine's instance): its beats are one piece of staging on the map's side. Asked of the user's own
    look like a cue: a combatant this view does not hold is in no beat, and what somebody concealed does gives none. */
export function eventShot(ev, now) {
  if (!isObj(ev) || !now || now.armed) return null;                                                 // (while the user aims: the map is under the user's hand)
  const key = typeof ev.inst === "string" && ev.inst ? ev.inst : null;
  if (!key) return null;
  const has = new Set(now.known), mine = new Set(now.mine), keep = (x) => { const id = cid(x); return id && has.has(id) ? id : null; };
  const actor = keep(ev.actor);
  if (ev.actor != null && !actor) return null;                                                      // done by somebody this view does not hold
  if (ev.type === "actionClosed") return { beat: "close", key, focus: null, with: [], still: false };
  const still = Object.keys(now.asks ?? {}).length > 0;                                             // a question waits for this user: nothing moves
  if (ev.type === "actionDeclared") {
    if (still || !actor || mine.has(actor) || ev.amended) return null;
    const to = typeof ev.decl?.to === "string" && ev.decl.to ? ev.decl.to : null;
    if (to && (ev.decl?.mode || ev.decl?.action === "move")) return { beat: "move", key, focus: actor, with: [], zone: to, still: false };
    const targets = ids((ev.targets ?? []).map(cid)).filter((x) => has.has(x) && x !== actor).slice(0, 12);
    if (!targets.length || targets.some((x) => mine.has(x))) return null;
    return { beat: "open", key, focus: targets[0], with: [...targets.slice(1), actor], still: false };
  }
  if (ev.type === "outcome" && typeof ev.hit === "boolean") {
    const target = keep(ev.target);
    return target ? { beat: ev.hit ? "hit" : "miss", key, focus: target, with: actor && actor !== target ? [actor] : [], still } : null;
  }
  if (ev.type === "broken") {
    const target = keep(ev.target);
    return target ? { beat: "kill", key, focus: target, with: actor && actor !== target ? [actor] : [], still } : null;
  }
  return null;
}
/** U98: the shot a CUE of a look asks for (somebody new in this user's view of the fight) -> the same shape | null */
export function cueShot(c, now) {
  if (!c || c.why !== "reveal" || !now || now.armed || Object.keys(now.asks ?? {}).length) return null;
  return { beat: "reveal", key: `reveal:${c.focus}`, focus: c.focus, with: [], still: false };
}
/** U98: did the user's own hand or a question take the screen between two looks (an action armed, a new question put to this
    user)? Then a shot on screen gives the view back at once. */
export function handTook(before, now) {
  if (!before || !now) return false;
  if (now.armed && now.armed !== before.armed) return true;
  return Object.keys(now.asks ?? {}).some((id) => !before.asks?.[id]);
}
/** The one cue this client acts on now (the most pressing), or null. */
export const cue = (before, now) => cues(before, now)[0] ?? null;

/** The switch on the dock (U42, U94, U98): the action camera -> turned down (the quiet cues of a turn) -> off. A map without
    shots keeps the older round turn -> off -> all. */
export const SWITCH = Object.freeze(["action", "turn", "off"]);
export const SWITCH_OLD = Object.freeze(["turn", "off", "all"]);
