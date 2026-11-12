/* Tactical combat, the surfaces: THE CHASE PANEL as render data (CHASE, CHASE2; pure, no DOM, node-tested in check-chase.mjs).
   USER 2026-11-12: the chase needs its own beautiful, clear panel, one, in the middle; of three trial looks the user kept B, the
   face-off, and asked "what about more complex chases?". Everything a seat needs during a chase is said here once, for whoever looks:
   who flees and who pursues (every unit of a side: a vehicle with its driver and passengers, somebody on foot or in the air), who rolls
   for each side and why, who cannot move, the distance and how near escape or capture is, the round and its beats (the obstacle, the
   two movement rolls, the result, the catch, the crew's shots), the decision this seat has to make with its buttons, who the table
   waits for, the GM's corrections (the obstacle, the distance, who joins or drops out, the ends), and how the chase ended. Nothing here
   decides a rule: every button carries the request or the roll action the dock and the desk already send, and the executor refuses
   what is not allowed.
     chaseData(view, own, facts, t) -> null | { on: true, ... } | { on: false, ended }
       view   the state this user may see (the full state for staff)
       own    the panel's own state on this client: { obstacle (the GM's pick for the next roll), join (the unit the GM is about to add),
              endSeen (number of the end card put away) }
       facts  model-pure's facts (c, staff, me, userName, online, rollBusy; whole: the executor's facts of a sheet, staff only)
     lineTrim(data, view) -> the dock's data without what the panel already says (the chase turn line, a news line of a chase round,
              the chase's own pieces of the "waiting for" line)
     isChasePrompt(p)   a question the panel answers (it is not drawn again as a card)
     wayOf(c)           how somebody moves fastest, as the chase reads it: "fly" | "foot" (the faces of the panel's units) */
import { chase as Rules } from "../../rules/index.mjs";
import { OBSTACLES, OUTCOMES, SIDES, rollerOf as rollerNow, stuckOf, groupsOf } from "../flows/chase.mjs";
import { vehOf, rideOf } from "../flows/vehicle.mjs";
import { modesOf } from "../movement-pure.mjs";
import { rollState } from "../desk-pure.mjs";
import { rollButtons, attrText } from "./model-pure.mjs";

/** the way a unit on its own moves fastest [B3432]: in the air or not (a vehicle is drawn as a vehicle) */
export function wayOf(c) {
  try { const best = modesOf(c).reduce((a, m) => ((Number(m.profile?.zones) || 0) > (Number(a?.profile?.zones) || 0) ? m : a), null); return ["flight", "wings"].includes(best?.mode) ? "fly" : "foot"; } catch { return "foot"; }
}
export const CHASE_PROMPTS = Object.freeze(["chaseCatch", "chaseOption"]);
export const isChasePrompt = (p) => CHASE_PROMPTS.includes(p?.kind);
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const usersOf = (p) => (isObj(p?.to) && Array.isArray(p.to.users) ? p.to.users : []);
const ROLL_KEYS = Object.freeze(["obs:prey", "obs:pursuer", "prey", "pursuer"]);
/* CHASE2 groups (ours): the round's rolls in the order they are made: the obstacle's (the prey, then each group), then the movement's */
const rollKeys = (rolls) => { const ks = Object.keys(rolls ?? {}), rank = (k) => (k.startsWith("obs:") ? (k === "obs:prey" ? 0 : 1) : k === "prey" ? 2 : 3); return ks.filter((k) => ROLL_KEYS.includes(k) || /^(obs:)?pursuer:g\d+$/.test(k)).sort((a, b) => rank(a) - rank(b)); };
/** CHASE2 groups: a group's letter (g1 -> A) */
export const letterOf = (gid, k = null) => { const n = Number(String(gid ?? "").replace(/^g/, "")); return String.fromCharCode(65 + Math.max(0, Math.min(25, (Number.isFinite(n) && n > 0 ? n : (k ?? 0) + 1) - 1))); };
/* how the obstacle reads, in our own words (the book's table is not copied): what it does to whom */
export const OBSTACLE_FX = Object.freeze(Object.fromEntries(OBSTACLES.map((id) => [id, `ITAC.chase.fx.${id}`])));

/* the GM reads the full state: the round's record as the view gives it to a player (view-pure instView) */
const fromCh = (c) => (isObj(c) ? { obstacle: c.obstacle ?? null, d66: c.d66 ?? null, chosen: c.chosen ? 1 : 0, from: c.distance ?? null, results: c.results ?? {}, over: c.over ?? null,
  ...Object.fromEntries(SIDES.map((s) => [s, isObj(c[s]) ? { id: c[s].id, roller: c[s].roller, vehicle: c[s].vehicle ? 1 : 0, why: c[s].why ?? null } : null])),
  ...(Array.isArray(c.groups) ? { groups: c.groups.map((g) => ({ id: g.id, distance: g.distance, lost: g.lost ?? null, roller: isObj(g.roller) ? { id: g.roller.id, roller: g.roller.roller, vehicle: g.roller.vehicle ? 1 : 0, why: g.roller.why ?? null } : null })) } : {}) } : null);
export const WHY = Object.freeze(["only", "slowest", "agility", "tie"]);
export const STUCK = Object.freeze(["gone", "down", "wrecked", "engine", "noDriver"]);
/** The whole panel. */
export function chaseData(view, own, facts, t) {
  const ch = isObj(view?.chase) && view.kind === "chase" ? view.chase : null;
  if (!ch) return endedData(view, own, facts, t);
  const staff = !!facts.staff, me = facts.me, owns = new Set(staff ? [] : Object.keys(view.knowledge ?? {}));
  const name = (id) => (id ? facts.c?.(id)?.name ?? t("ITAC.Someone") : t("ITAC.Someone")), img = (id) => (id ? facts.c?.(id)?.img ?? null : null);
  const inst = (view.stack ?? []).find((i) => !i.masked && i.flow === "chase") ?? null, kids = inst ? (view.stack ?? []).filter((i) => !i.masked && i.parent === inst.id) : [];
  const info = inst?.data?.chase ?? fromCh(inst?.data?.ch), rolled = ch.rolled === view.round;
  const phase = inst ? "rolling" : rolled ? "after" : "before";
  /* FXU (D191): after the round its record (state.chase.last) tells the chase as the round left it, until the GM changed who is in it or
     how far apart they are (flows/chase.setPatch `edited`): then the record is history (the result beat) and everything that speaks of
     the chase of now (the distance's heading, the catch, who rolls and why, what each group moved) reads the chase as it stands */
  const fresh = phase === "after" && isObj(ch.last) && !ch.last.edited;
  const busy = (view.stack ?? []).length > 0;
  /* the grants of the crew: one ranged attack each after the roll [B3438]; a used one is gone from the list (U172) */
  /* CHASE2: only the grants this chase gave this round (a shot left from an earlier chase of the same round is not this chase's) */
  const crewNow = ch.crew?.round === view.round ? new Set(ch.crew.ids ?? []) : new Set();
  const crewOf = (pid) => { if (!crewNow.has(pid)) return null; const g = (view.ledger?.[pid]?.grants ?? []).find((x) => x.kind === "chaseCrew"); return g ? (g.usedBy ? "used" : "open") : null; };
  /* CHASE2: the full facts (the GM's) answer who would roll next and who cannot move; a player reads the vehicles (table knowledge) */
  const full = staff && typeof facts.whole === "function" ? { state: view, facts: { c: (id) => facts.whole(id) } } : null;
  const stuck = (id) => {
    if (full) { try { return stuckOf(full, id); } catch { /* the facts are not there */ } }
    const c = facts.c?.(id), rec = view.vehicles?.[id];
    if (!c) return "gone";
    return c.kind === "vehicle" || isObj(rec) ? (rec?.wrecked ? "wrecked" : rec?.off?.engine ? "engine" : !rec?.driver ? "noDriver" : null) : null;
  };
  /* WHO ROLLS FOR A SIDE AND WHY [B3479]: in a round, the one it named; after it, the one who rolled (state.chase.last.by); before it,
     the GM's facts say who would; a player knows it only when one unit of the side can move */
  /* CHASE2 groups (ours): the pursuers in groups, each at its own distance; each group has its own roller */
  const gs = groupsOf(ch);
  const rollerFor = (side, gid = null) => {
    const by = fresh ? (gid ? ch.last?.by?.groups?.[gid] : ch.last?.by?.[side]) : null;
    const r = (gid ? (info?.groups ?? []).find((g) => g.id === gid)?.roller : info?.[side]) ?? (by ? { id: by.unit, roller: by.roller, why: by.why } : null);
    if (r?.id) return { id: r.id, roller: r.roller ?? r.id, why: WHY.includes(r.why) ? r.why : null };
    if (gid && phase === "rolling") return null;
    if (full) { try { const p = rollerNow(full, side, gid); if (p) return { id: p.id, roller: p.roller, why: p.why, next: 1 }; } catch { /* the facts are not there */ } }
    const able = (gid ? gs.find((g) => g.id === gid)?.units ?? [] : ch.sides?.[side] ?? []).filter((u) => !stuck(u));
    if (able.length === 1) { const rec = view.vehicles?.[able[0]]; return { id: able[0], roller: rec?.driver ?? able[0], why: "only", next: 1 }; }
    return null;
  };
  const way = (id) => facts.c?.(id)?.way ?? (full ? wayOf(facts.whole(id)) : "foot");
  const unit = (id, side, r, last, grp = null) => {
    const c = facts.c?.(id) ?? null, veh = view.vehicles?.[id] ?? null, vehicle = c?.kind === "vehicle" || isObj(veh), rec = vehicle ? vehOf(view, id) : null;
    const people = vehicle ? [rec.driver ? { id: rec.driver, role: "driver" } : null, ...rec.crew.map((p) => ({ id: p, role: "passenger" }))].filter(Boolean) : [{ id, role: way(id) === "fly" ? "fly" : "self" }];
    const st = stuck(id);
    return { id, side, name: name(id), img: img(id), vehicle, rolls: r?.id === id, mine: people.some((p) => owns.has(p.id)), stuck: st, stuckText: st ? t(`ITAC.chase.stuck.${st}`) : null,
      people: people.map((p) => ({ ...p, name: name(p.id), img: img(p.id), mine: owns.has(p.id), crew: crewOf(p.id), rolls: r?.id === id && r.roller === p.id, roleText: t(`ITAC.chase.role.${p.role}`) })),
      /* the GM takes a unit out of the chase (P8e-R8: not under a roll being made); the last one of a side is not taken out: the chase ends instead */
      drop: staff ? { label: t("ITAC.chase.gm.drop", { name: name(id) }), req: busy || last ? null : { op: "chaseSet", unit: id, side: null }, disabled: busy ? t("ITAC.reason.busy") : last ? t("ITAC.chase.gm.dropLast") : null } : null,
      /* CHASE2 groups (ours, G7): the GM splits a pursuer off into a group of its own (at the same distance), or puts one that is alone
         into the nearest other group */
      group: staff && side === "pursuer" ? groupMove(id, grp) : null };
  };
  const groupMove = (id, grp) => {
    const list = ch.sides?.pursuer ?? [];
    if (list.length < 2) return null;
    const mine = grp ?? null, alone = mine ? mine.units.length === 1 : false;
    const other = alone ? [...gs].filter((g) => g.id !== mine.id && !g.lost).sort((a, b) => a.distance - b.distance)[0] ?? gs.find((g) => g.id !== mine.id) : null;
    const req = alone ? (other ? { op: "chaseSet", unit: id, side: "pursuer", group: other.id } : null) : { op: "chaseSet", unit: id, side: "pursuer", group: "new" };
    const label = alone ? t("ITAC.chase.gm.merge", { name: name(id), x: other ? letterOf(other.id) : "?" }) : t("ITAC.chase.gm.split", { name: name(id) });
    return { kind: alone ? "merge" : "split", label, req: busy ? null : req, disabled: busy ? t("ITAC.reason.busy") : null };
  };
  const sides = SIDES.slice().reverse().map((s) => {
    const list = ch.sides?.[s] ?? [];
    if (s === "pursuer" && gs) {
      /* the groups, the nearest first (a group that lost the prey last); the side's roller is the nearest group's */
      const order = gs.map((g, k) => ({ g, k })).sort((a, b) => (!!a.g.lost - !!b.g.lost) || a.g.distance - b.g.distance || a.k - b.k).map(({ g }) => g);
      const groups = order.map((g) => {
        const r = g.lost ? null : rollerFor(s, g.id), units = g.units.map((u) => unit(u, s, r, list.length === 1, g));
        const ru = units.find((u) => u.rolls) ?? null, rp = ru ? ru.people.find((p) => p.rolls) ?? ru.people[0] ?? null : null;
        const res = fresh ? ch.last?.groups?.[g.id] ?? null : null;
        return { id: g.id, letter: letterOf(g.id), label: t("ITAC.chase.group", { x: letterOf(g.id) }), distance: g.distance, lost: g.lost ?? null, lostText: g.lost ? t(`ITAC.chase.lost.${g.lost === "hiddenPath" ? "hiddenPath" : "far"}`) : null,
          units, roller: ru, who: rp, mine: units.some((u) => u.mine), able: units.filter((u) => !u.stuck).length,
          rolls: { text: rp ? t(r?.next && phase !== "rolling" ? "ITAC.chase.rollsNext" : "ITAC.chase.rollsBy", { name: rp.name }) : g.lost ? "" : units.length > 1 ? t("ITAC.chase.why.unknown") : "", why: ru && units.length > 1 && r?.why ? t(`ITAC.chase.why.${r.why}`) : null },
          moved: res && Number.isFinite(res.from) ? { from: res.from, to: res.to, text: t("ITAC.chase.groupMoved", { from: res.from, to: res.to }) } : null,
          gm: staff ? { minus: !busy && g.distance > 0 ? { op: "chaseSet", group: g.id, distance: g.distance - 1 } : null, plus: !busy && g.distance < 99 ? { op: "chaseSet", group: g.id, distance: g.distance + 1 } : null,
            tip: t("ITAC.chase.gm.groupDist", { x: letterOf(g.id) }) } : null };
      });
      const lead = groups.find((g) => !g.lost) ?? groups[0];
      const units = groups.flatMap((g) => g.units);
      return { id: s, label: t(`ITAC.ui.chase.${s}`), units, groups, mine: units.some((u) => u.mine), roller: lead.roller, who: lead.who, lead: lead.roller ?? lead.units[0] ?? null,
        able: groups.filter((g) => !g.lost).reduce((n, g) => n + g.able, 0), rolls: lead.rolls };
    }
    const r = rollerFor(s), units = list.map((u) => unit(u, s, r, list.length === 1));
    const ru = units.find((u) => u.rolls) ?? null, rp = ru ? ru.people.find((p) => p.rolls) ?? ru.people[0] ?? null : null;
    const why = ru && units.length > 1 && r?.why ? t(`ITAC.chase.why.${r.why}`) : null;
    /* `roller`: the unit that rolls (or rolled) for the side, when known; `who`: the person at its dice; `lead`: whose picture stands for the side */
    return { id: s, label: t(`ITAC.ui.chase.${s}`), units, mine: units.some((u) => u.mine), roller: ru, who: rp, lead: ru ?? units[0] ?? null, able: units.filter((u) => !u.stuck).length,
      rolls: { text: rp ? t(r?.next && phase !== "rolling" ? "ITAC.chase.rollsNext" : "ITAC.chase.rollsBy", { name: rp.name }) : units.length > 1 ? t("ITAC.chase.why.unknown") : "", why } };
  });
  const mySide = sides.find((s) => s.mine)?.id ?? null;
  const seat = staff ? "gm" : sides.some((s) => s.units.some((u) => u.people.some((p) => p.mine && ["driver", "self", "fly"].includes(p.role)))) ? "driver" : mySide ? "crew" : "aside";

  /* the rolls of the round: the chase's own and those of what it set off (the ram or charge on a catch) */
  const rowOf = (i, r) => { const st = rollState(r);
    return { inst: i.id, key: r.key, who: r.who, whoName: name(r.who), attr: r.attr ?? null, state: st, users: r.req?.users ?? [], rid: r.req?.rid ?? null, messageId: r.messageId ?? null, sixes: r.forced?.sixes ?? r.sixes ?? null,
      pushed: r.pushed ?? 0, dice: r.req?.dice ?? r.pool?.total ?? null, askReq: staff && st === "owed" && r.req ? { op: "askRoll", inst: i.id, roll: r.key } : null,
      acceptReq: staff && st === "push" ? { op: "setSixes", inst: i.id, roll: r.key, sixes: r.sixes, accept: true, pushed: r.pushed ?? 0 } : null }; };
  const rolls = [...(inst ? rollKeys(inst.rolls).map((k) => rowOf(inst, inst.rolls[k])) : []), ...kids.flatMap((i) => Object.values(i.rolls ?? {}).map((r) => ({ ...rowOf(i, r), catch: 1 })))];
  const mineRoll = (r) => r.users.includes(me) || (staff && r.users.includes("gm"));
  const sideRoll = (side, gid = null) => {
    const r = rolls.find((x) => x.key === (gid ? `${side}:${gid}` : side));
    const auto = side === "prey" && (info?.obstacle ?? (phase === "after" ? ch.last?.obstacle : null)) === "deadEnd";
    if (phase === "after" && !fresh && !r) return { state: "none", sixes: null, text: "" };
    if (phase === "after" && !r) { const n = gid ? ch.last?.groups?.[gid]?.sixes : ch.last?.[side]; return { state: auto ? "auto" : n == null ? "none" : "done", sixes: n ?? null, text: auto ? t("ITAC.chase.roll.auto") : n == null ? "" : t("ITAC.chase.roll.sixes", { n }) }; }
    if (!r) return { state: auto && phase === "rolling" ? "auto" : "none", sixes: null, text: auto && phase === "rolling" ? t("ITAC.chase.roll.auto") : "" };
    const buttons = rollButtons(r, facts, t);
    return { state: r.state, sixes: r.sixes, dice: r.dice, who: r.who, whoName: r.whoName, mine: mineRoll(r), pushed: r.pushed, buttons,
      text: r.state === "owed" ? t("ITAC.chase.roll.owed", { dice: r.dice ?? "?" }) : t(r.pushed ? "ITAC.chase.roll.pushed" : "ITAC.chase.roll.sixes", { n: r.sixes ?? 0 }) };
  };
  for (const s of sides) {
    if (s.groups) { for (const g of s.groups) g.roll = g.lost && phase !== "after" ? { state: "none", sixes: null, text: "" } : sideRoll(s.id, g.id); const lead = s.groups.find((g) => !g.lost) ?? s.groups[0]; s.roll = lead.roll; }
    else s.roll = sideRoll(s.id);
  }

  /* the obstacle of the round: being met now, or the one of the round just played */
  const obsId = phase === "rolling" ? info?.obstacle ?? null : phase === "after" ? ch.last?.obstacle ?? null : null;
  const obsRolls = rolls.filter((r) => r.key.startsWith("obs:")).map((r) => ({ side: r.key.slice(4), state: r.state, sixes: r.sixes, whoName: r.whoName, attr: attrText(t, r.attr), buttons: rollButtons(r, facts, t), mine: mineRoll(r) }));
  const obstacle = obsId ? { id: obsId, name: t(`ITAC.ui.chase.obstacle.${obsId}`, {}, obsId), fx: t(OBSTACLE_FX[obsId] ?? "ITAC.chase.fx.clear"), d66: info?.d66 ?? null, chosen: !!info?.chosen,
    clear: obsId === "clear", rolls: obsRolls, tag: info?.chosen ? t("ITAC.chase.obstacle.chosen") : info?.d66 ? t("ITAC.chase.obstacle.d66", { n: info.d66 }) : null } : null;
  const obsOn = !!ch.obstacles || !!obsId;

  /* where the round stands: the beats in the book's order [B3432-3442] */
  const liveGroups = (sides[0].groups ?? []).filter((g) => !g.lost && g.roller);
  const step = inst?.step ?? null, preyDone = ["done", "auto"].includes(sides[1].roll.state), purDone = sides[0].groups ? liveGroups.every((g) => g.roll.state === "done") : sides[0].roll.state === "done";
  const caughtNow = phase === "after" ? fresh && !!ch.last?.caught : ["catch", "crew", "close"].includes(step) && (ch.distance ?? 1) <= 0;
  const crewList = sides.flatMap((s) => s.units.flatMap((u) => u.people.filter((p) => p.crew).map((p) => ({ ...p, side: s.id }))));
  const crewOpen = crewList.filter((p) => p.crew === "open");
  const beat = (id, state, text = "", extra = {}) => ({ id, label: t(`ITAC.chase.beat.${id}`), state, text, ...extra });
  const order = ["obstacle", "prey", "pursuer", "result", "catch", "crew"];
  const nowAt = phase === "before" ? -1 : phase === "after" ? (crewOpen.length ? order.indexOf("crew") : order.length)
    : ["check", "obstacle"].includes(step) ? 0 : step === "movement" ? (preyDone ? 2 : 1) : step === "result" ? 3 : step === "catch" ? 4 : 5;
  const stateAt = (id) => { const k = order.indexOf(id); return nowAt < 0 ? "next" : k < nowAt ? "done" : k === nowAt ? "now" : "next"; };
  const told = phase === "after" && ch.last ? resultOf(ch, t) : null, result = fresh ? told : null;
  /* CHASE2: the catch names who strikes and whom: the one who rolled for the pursuers, at the one who rolled for the fleeing (the
     engine's catch [B3434]; with several units on a side the others arrive with them and do not strike: question CHASE2-1) */
  const catchQ = Object.values(view.prompts ?? {}).find((p) => p.kind === "chaseCatch" && !p.answered) ?? null;
  const catcher = catchQ?.about ? name(catchQ.about) : sides[0].who?.name ?? sides[0].lead?.name ?? "", caughtOne = catchQ?.data?.target ? name(catchQ.data.target) : sides[1].roller?.name ?? sides[1].lead?.name ?? "";
  const ram = catchQ ? !!catchQ.data?.ram : !!sides[0].roller?.vehicle;
  const catchInfo = caughtNow || (phase === "rolling" && step === "catch") ? { by: catcher, at: caughtOne, ram, text: t(ram ? "ITAC.chase.catch.whoRam" : "ITAC.chase.catch.whoCharge", { name: catcher, target: caughtOne }) } : null;
  const beats = [
    obsOn ? beat("obstacle", stateAt("obstacle"), obstacle ? obstacle.name : phase === "before" ? t("ITAC.chase.obstacle.next") : "") : null,
    beat("prey", stateAt("prey"), sides[1].roll.text, { who: sides[1].who?.name ?? "" }),
    beat("pursuer", stateAt("pursuer"), sides[0].groups ? sides[0].groups.filter((g) => g.roll.text).map((g) => `${g.letter}: ${g.roll.text}`).join(", ") : sides[0].roll.text,
      { who: sides[0].groups ? sides[0].groups.map((g) => g.who?.name).filter(Boolean).join(", ") : sides[0].who?.name ?? "" }),
    beat("result", stateAt("result"), told ? (fresh ? told.short : told.head) : ""),
    catchInfo ? beat("catch", stateAt("catch"), catchInfo.text) : null,
    crewList.length ? beat("crew", phase === "after" ? (crewOpen.length ? "now" : "done") : stateAt("crew"), crewOpen.length ? t("ITAC.chase.crew.left", { n: crewOpen.length }) : phase === "after" ? t("ITAC.chase.crew.none") : t("ITAC.chase.crew.order")) : null,
  ].filter(Boolean);
  if (purDone && preyDone && phase === "rolling" && step === "movement") beats.find((b) => b.id === "result").state = "now";

  /* THE DECISION: what this seat has to do now, with its buttons; else who the table waits for */
  const prompts = Object.values(view.prompts ?? {}).filter((p) => isChasePrompt(p) && !p.answered);
  const lineOf = (p) => p.kind === "chaseCatch" ? t(p.data?.ram ? "ITAC.ui.line.chaseRam" : "ITAC.ui.line.chaseCharge", { name: name(p.about), target: name(p.data?.target) })
    : t("ITAC.ui.line.chaseOption", { name: name(p.about), obstacle: t(`ITAC.ui.chase.obstacle.${p.data?.obstacle}`, {}, String(p.data?.obstacle ?? "")), attr: attrText(t, p.data?.attr) });
  const optLabel = (p, o) => (p.kind === "chaseCatch" && o.id === "attack" ? t(p.data?.ram ? "ITAC.action.ram" : "ITAC.opt.charge") : t(o.label ?? `ITAC.opt.${o.id}`, {}, String(o.id)));
  const forMe = (p) => (staff ? p.to === "gm" : usersOf(p).includes(me));
  const answer = (p, proxy) => (p.options ?? []).map((o, k) => ({ id: `ans:${p.id}:${o.id}`, label: optLabel(p, o), primary: k === 0, req: { op: proxy || (staff && p.to === "gm") ? "answerFor" : "answer", prompt: p.id, value: o.id } }));
  const who = (users, about) => { const u = (users ?? []).filter((x) => x !== "gm").map((x) => facts.userName?.(x)).filter(Boolean); return u.length ? t("ITAC.chase.wait.player", { name: name(about), user: u.join(", ") }) : t("ITAC.chase.wait.gm", { name: name(about) }); };
  let decision = null;
  const myPrompt = prompts.find(forMe);
  const myRolls = rolls.filter((r) => r.state !== "done" && mineRoll(r));
  if (myPrompt) decision = { kind: myPrompt.kind, title: t(`ITAC.prompt.${myPrompt.kind}`), text: lineOf(myPrompt), buttons: answer(myPrompt, false), mine: true };
  else if (myRolls.length) {
    const r = myRolls[0], obs = r.key.startsWith("obs:");
    decision = { kind: r.catch ? "catchRoll" : obs ? "obstacleRoll" : "roll", mine: true, title: t(r.catch ? "ITAC.chase.do.catchRoll" : obs ? "ITAC.chase.do.obstacleRoll" : r.state === "push" ? "ITAC.chase.do.push" : "ITAC.chase.do.roll", { name: r.whoName }),
      text: r.state === "push" ? t("ITAC.chase.do.pushText", { n: r.sixes ?? 0 }) : obs ? t("ITAC.chase.do.obstacleText", { attr: attrText(t, r.attr), dice: r.dice ?? "?" })
        : r.catch ? t(r.attr ? "ITAC.chase.do.catchText" : "ITAC.chase.do.catchDice", { attr: attrText(t, r.attr), dice: r.dice ?? "?" }) : t(`ITAC.chase.do.rollText.${r.key === "prey" ? "prey" : "pursuer"}`, { dice: r.dice ?? "?" }),
      buttons: rollButtons(r, facts, t).map((b) => ({ ...b, primary: b.id === "roll" || b.id === "accept" })), sixes: r.sixes, dice: r.dice, state: r.state };
  } else if (!inst && crewOpen.some((p) => p.mine)) {
    const p = crewOpen.find((x) => x.mine);
    /* [B3438]: the pursuers' crews shoot first, then the fleeing ones' (the order is the table's; the engine does not hold it, P8e-R6) */
    const first = p.side === "prey" && crewOpen.some((x) => x.side === "pursuer");
    decision = { kind: "crew", mine: true, title: t("ITAC.chase.do.crew", { name: p.name }), text: t(first ? "ITAC.chase.do.crewAfter" : "ITAC.chase.do.crewText"),
      buttons: crewOpen.filter((x) => x.mine).map((x, k) => ({ id: `shoot:${x.id}`, label: crewOpen.filter((y) => y.mine).length > 1 ? t("ITAC.chase.shootAs", { name: x.name }) : t("ITAC.action.shoot"), primary: k === 0, arm: { sel: x.id, action: "shoot" } })) };
  }
  /* who else the table waits for (a GM may settle it) */
  const waits = [...prompts.filter((p) => !forMe(p)).map((p) => ({ id: p.id, text: `${who(p.to === "gm" ? ["gm"] : usersOf(p), p.about)}: ${t(`ITAC.prompt.${p.kind}`)}`,
      buttons: staff ? [...answer(p, true).map((b) => ({ ...b, primary: false, label: t("ITAC.chase.for", { what: b.label }) })), ...(usersOf(p).length ? [{ id: `nudge:${p.id}`, label: t("ITAC.chase.nudge"), req: { op: "nudge", prompt: p.id } }] : [])] : [] })),
    ...rolls.filter((r) => r.state !== "done" && !mineRoll(r)).map((r) => ({ id: `${r.inst}:${r.key}`, text: `${who(r.users, r.who)}: ${t(r.state === "push" ? "ITAC.chase.wait.push" : "ITAC.chase.wait.roll")}`,
      buttons: staff ? [...rollButtons(r, facts, t), ...(r.users.some((u) => u !== "gm") ? [{ id: `nudge:${r.inst}:${r.key}`, label: t("ITAC.chase.nudge"), req: { op: "nudge", inst: r.inst, roll: r.key } }] : [])] : [] }))];
  /* the crews still to shoot, side by side, the pursuers first [B3438]; the GM may arm the shot of anyone of them (an NPC, or a player away) */
  const crewText = (list) => SIDES.slice().reverse().map((s) => { const n = list.filter((p) => p.side === s).map((p) => p.name); return n.length ? t("ITAC.chase.wait.crewSide", { side: t(`ITAC.ui.chase.${s}`), names: n.join(", ") }) : null; }).filter(Boolean).join("; ");
  const others = crewOpen.filter((p) => !p.mine);
  if (!inst && others.length) waits.push({ id: "crew", text: t("ITAC.chase.wait.crew", { names: crewText(others) }), optional: true,
    buttons: staff ? others.map((p) => ({ id: `arm:${p.id}`, label: t("ITAC.chase.gm.shootFor", { name: p.name }), arm: { sel: p.id, action: "shoot" } })) : [] });

  /* the GM's controls: the next roll (with the obstacle the GM may name), the distance, the table, who joins or drops out, the ends */
  const escaped = !!ch.over || ch.distance > ch.lostAt, caught = ch.distance <= 0;
  let gm = null;
  if (staff) {
    const pick = OBSTACLES.includes(own?.obstacle) ? own.obstacle : "auto";
    /* a side with nobody who can move has no roll [B3479]: the GM is told which, before the engine refuses */
    const still = sides.find((s) => !s.able);
    /* CHASE2: the next roll opens the next fight round (director D101), which waits while this round's start card is open */
    const card = rolled && view.phase && view.phase !== "turns" && !inst;
    const rollWhy = busy ? t("ITAC.reason.busy") : escaped ? t("ITAC.chase.gm.over") : still ? t("ITAC.chase.gm.noRoller", { side: still.label }) : card ? t("ITAC.chase.gm.roundCard") : null;
    /* CHASE2: who may join (P8e-R8: not under a roll being made): somebody of the fight on their own, or a vehicle with somebody at the
       wheel; a rider comes with the vehicle */
    const inChase = new Set(SIDES.flatMap((s) => ch.sides?.[s] ?? []));
    const pool = [...new Set([...Object.keys(view.ledger ?? {}), ...Object.keys(view.vehicles ?? {})])].filter((id) => {
      const c = facts.c?.(id);
      if (!c || c.kind === "challenge" || inChase.has(id) || rideOf(view, id)) return false;
      if (c.kind === "vehicle" || isObj(view.vehicles?.[id])) { const r = vehOf(view, id); return !!r.driver && !r.wrecked; }
      return true;
    });
    const unitLabel = (id) => { const r = isObj(view.vehicles?.[id]) ? vehOf(view, id) : null; return r?.driver ? t("ITAC.ui.chase.driven", { vehicle: name(id), name: name(r.driver) }) : name(id); };
    const joinId = pool.includes(own?.join) ? own.join : pool[0] ?? null;
    gm = {
      roll: { label: t(rolled ? "ITAC.chase.gm.next" : "ITAC.chase.gm.roll", { n: (ch.round ?? 0) + 1 }), disabled: rollWhy,
        req: rollWhy ? null : { op: "chaseRound", ...(pick !== "auto" ? { obstacle: pick } : {}) } },
      join: { label: t("ITAC.chase.gm.join"), value: joinId, choices: pool.map((id) => ({ id, label: unitLabel(id) })), none: pool.length ? null : t("ITAC.chase.gm.nobodyFree"),
        to: SIDES.slice().reverse().map((s) => ({ id: `join:${s}`, label: t(`ITAC.chase.gm.joinTo.${s}`), disabled: busy ? t("ITAC.reason.busy") : !joinId ? t("ITAC.chase.gm.nobodyFree") : null,
          req: busy || !joinId ? null : { op: "chaseSet", unit: joinId, side: s } })) },
      obstacle: { label: t("ITAC.chase.gm.obstacle"), value: pick, choices: [{ id: "auto", label: t(ch.obstacles ? "ITAC.chase.gm.table" : "ITAC.chase.gm.none") }, ...OBSTACLES.map((id) => ({ id, label: t(`ITAC.ui.chase.obstacle.${id}`, {}, id) }))] },
      table: { label: t("ITAC.ui.chase.obstacles"), on: !!ch.obstacles, req: { op: "chaseSet", obstacles: !ch.obstacles } },
      distance: { label: t(gs ? "ITAC.chase.nearest" : "ITAC.ui.chase.distance"), value: ch.distance, minus: ch.distance > 0 ? { op: "chaseSet", distance: ch.distance - 1 } : null, plus: ch.distance < 99 ? { op: "chaseSet", distance: ch.distance + 1 } : null, tip: t("ITAC.chase.gm.distanceTip") },
      ends: OUTCOMES.map((o) => ({ id: o, label: t(`ITAC.chase.end.do.${o}`), tip: t(`ITAC.chase.end.tip.${o}`), disabled: busy ? t("ITAC.reason.busy") : null, req: busy ? null : { op: "chaseEnd", outcome: o },
        primary: (o === "escaped" && escaped) || (o === "combat" && caught && phase === "after") })),
    };
    if (!decision && !inst) decision = { kind: "gmRoll", mine: true, title: escaped ? t("ITAC.chase.gm.overTitle") : t(rolled ? "ITAC.chase.gm.nextTitle" : "ITAC.chase.gm.rollTitle", { n: (ch.round ?? 0) + 1 }),
      /* the crews still open stand on the waiting line under it, with the GM's shot buttons: not said twice */
      /* FXU (D190): the obstacle is named only when there will be one: the table is on, or the GM picked one for the next roll */
      text: escaped ? t("ITAC.chase.gm.overText") : t(ch.obstacles || pick !== "auto" ? "ITAC.chase.gm.rollText" : "ITAC.chase.gm.rollTextPlain"),
      buttons: escaped ? gm.ends.filter((b) => b.id === "escaped").map((b) => ({ ...b, primary: true })) : [{ id: "gm:roll", label: gm.roll.label, primary: true, disabled: gm.roll.disabled, req: gm.roll.req }] };
  }

  /* the distance: how near escape and capture are (the gap counts zones; the prey is lost when it EXCEEDS lostAt [B3436]) */
  const d = Math.max(0, Number(ch.distance) || 0), L = Math.max(1, Number(ch.lostAt) || Rules.CHASE_END_DISTANCE);
  const status = caught ? { id: "caught", text: t("ITAC.ui.chase.caught"), tone: "hit" } : escaped ? { id: "escaped", text: t("ITAC.ui.chase.escaped"), tone: "miss" } : { id: "run", text: t("ITAC.ui.chase.apart", { n: d }), tone: null };
  const toEscape = escaped ? 0 : L + 1 - d, toCatch = d;
  return {
    on: true, seat, mySide, phase, round: ch.round ?? 0, title: t("ITAC.ui.chase"),
    roundLabel: phase === "before" ? t("ITAC.chase.round.before", { n: (ch.round ?? 0) + 1 }) : t("ITAC.chase.round.n", { n: phase === "rolling" && !rolled ? (ch.round ?? 0) + 1 : ch.round ?? 0 }),
    distance: { value: d, lostAt: L, max: L + 1, status, toEscape, toCatch, from: fresh ? ch.last?.from ?? null : null,
      say: caught ? t("ITAC.chase.say.caught") : escaped ? t("ITAC.chase.say.escaped") : t("ITAC.chase.say.run", { catch: toCatch, escape: toEscape }),
      escapeText: t("ITAC.chase.escapeAt", { n: L + 1 }), catchText: t("ITAC.chase.catchAt"), unit: t("ITAC.chase.zones", { n: d }),
      /* CHASE2 groups (ours): where each pursuing group stands on the track (a lost one beyond its end) */
      label: gs ? t("ITAC.chase.nearest") : null, marks: sides[0].groups ? sides[0].groups.map((g) => ({ id: g.id, letter: g.letter, at: Math.min(L + 1, g.distance), lost: !!g.lost, mine: g.mine })) : null },
    sides, obstacle, beats, result, decision, waits, gm, catch: catchInfo, crowd: Math.max(...sides.map((s) => s.units.length)),
    you: seat === "gm" ? null : seat === "aside" ? t("ITAC.chase.you.aside") : t(`ITAC.chase.you.${seat}.${mySide}`),
    labels: { waiting: t("ITAC.ui.waitingFor"), round: t("ITAC.chase.label.round"), obstacle: t("ITAC.chase.beat.obstacle"), gm: t("ITAC.chase.label.gm"), ends: t("ITAC.chase.label.ends"), crew: t("ITAC.chase.label.crew"), shotOpen: t("ITAC.chase.shot.open"), shotUsed: t("ITAC.chase.shot.used"), distance: t("ITAC.ui.chase.distance"), fold: t("ITAC.chase.fold"), unfold: t("ITAC.chase.unfold") },
  };
}

/** what one round came to, from state.chase.last */
export function resultOf(ch, t) {
  const l = ch.last ?? {}, from = Number.isFinite(l.from) ? l.from : null, to = ch.distance, moved = from == null ? 0 : to - from;
  const head = l.escaped ? t("ITAC.chase.res.escaped") : l.caught ? t("ITAC.chase.res.caught") : l.winner ? t(`ITAC.chase.res.win.${l.winner}`, { n: Math.abs(moved) }) : t("ITAC.chase.res.tie");
  return { winner: l.winner ?? null, from, to, moved, caught: !!l.caught, escaped: !!l.escaped, head, short: from == null ? head : `${head} (${from} > ${to})`,
    rolls: l.prey == null && l.pursuer == null ? null : { prey: l.prey ?? 0, pursuer: l.pursuer ?? 0 } };
}

/** T064: which end card this seat put away, from the browser's record ("<combatId>:<n>") and the page's own one (a private window
    cannot store it; the card must still close). The later number wins. */
export function endSeenOf(combatId, stored, mem) {
  const one = (v) => { const s = String(v ?? ""); if (!combatId || !s.startsWith(`${combatId}:`)) return null; const n = Number(s.slice(String(combatId).length + 1)); return Number.isFinite(n) ? n : null; };
  const a = one(stored), b = one(mem);
  return a == null ? b : b == null ? a : Math.max(a, b);
}

/** the card every seat sees once the chase is over (engine-pure chaseEnd writes state.chaseEnded) */
function endedData(view, own, facts, t) {
  const e = isObj(view?.chaseEnded) ? view.chaseEnded : null;
  if (!e || Number(own?.endSeen) === Number(e.n)) return null;
  const name = (id) => facts.c?.(id)?.name ?? t("ITAC.Someone"), out = OUTCOMES.includes(e.outcome) ? e.outcome : "combat";
  /* a vehicle is named with whoever drives it, as the GM's desk names it */
  const unitName = (id) => { const r = isObj(view.vehicles?.[id]) ? vehOf(view, id) : null; return r?.driver ? t("ITAC.ui.chase.driven", { vehicle: name(id), name: name(r.driver) }) : name(id); };
  return { on: false, ended: { n: e.n, outcome: out, title: t(`ITAC.chase.end.${out}`), text: t(`ITAC.chase.end.text.${out}`, { n: e.rounds ?? 0, d: e.distance ?? 0 }),
    sides: ["pursuer", "prey"].map((s) => ({ id: s, label: t(`ITAC.ui.chase.${s}`), names: (e.sides?.[s] ?? []).map(unitName).join(", "), units: (e.sides?.[s] ?? []).map(unitName) })),
    rounds: t("ITAC.chase.end.rounds", { n: e.rounds ?? 0 }), close: { label: t("ITAC.chase.end.close"), endSeen: e.n } }, title: t("ITAC.ui.chase") };
}

/** CHASE (U169 / U170): while the panel shows, the dock's line does not say the chase again (its turn line, the news of a chase round)
    and the summary of a chase round does not stand over the map; the panel answers the chase's own questions */
export function lineTrim(data, view) {
  if (!data || view?.kind !== "chase" || !isObj(view?.chase)) return data;
  const chaseIds = new Set(Object.values(view.prompts ?? {}).filter((p) => isChasePrompt(p)).map((p) => p.id));
  const round = (view.stack ?? []).find((i) => i.flow === "chase"), ours = new Set(round ? (view.stack ?? []).filter((i) => i.id === round.id || i.parent === round.id).map((i) => i.id) : []);
  const out = { ...data, turn: "", sum: null, prompts: (data.prompts ?? []).filter((p) => !chaseIds.has(p.id)), rolls: (data.rolls ?? []).filter((r) => !ours.has(r.inst)) };
  const n = (view.news ?? []).find((x) => x?.id === data.news?.id);
  if (n && n.action === "chaseRound") out.news = null;
  /* the line's "waiting for" names only what the panel does not (CHASE2, CHASE-6): each row loses the chase's own pieces (its questions,
     the rolls of its round and of what the round set off), a row left with nothing goes; the rest of the line stays as it was */
  const chasePiece = (id) => !!id && (chaseIds.has(id) || ours.has(String(id).split(":")[0]));
  out.waiting = (data.waiting ?? []).map((w) => {
    const ids = Array.isArray(w.ids) ? w.ids : [];
    if (!ids.length || !ids.some(chasePiece)) return w;
    const keep = ids.map((id, k) => (chasePiece(id) ? -1 : k)).filter((k) => k >= 0);
    return keep.length ? { ...w, ids: keep.map((k) => ids[k]), what: keep.map((k) => w.what?.[k]).filter((x) => x != null) } : null;
  }).filter(Boolean);
  return out;
}
