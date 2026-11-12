/* Tactical combat, the surfaces: THE CHASE PANEL as render data (CHASE; pure, no DOM, node-tested in check-chase.mjs).
   USER 2026-11-12: the chase needs its own beautiful, clear panel, one, in the middle. Everything a seat needs during a chase is said
   here once, for whoever looks: who flees and who pursues, the distance and how near escape or capture is, the round and its beats
   (the obstacle, the two movement rolls, the result, the catch, the crew's shots), the decision this seat has to make with its buttons,
   who the table waits for, the GM's corrections, and how the chase ended. Three looks draw the same data (ui/chase.mjs: A "road",
   B "face-off", C "storyboard"); nothing here decides a rule: every button carries the request or the roll action the dock and the
   desk already send, and the executor refuses what is not allowed.
     chaseData(view, own, facts, t) -> null | { on: true, ... } | { on: false, ended }
       view   the state this user may see (the full state for staff)
       own    the panel's own state on this client: { obstacle (the GM's pick for the next roll), endSeen (number of the end card put away) }
       facts  model-pure's facts (c, staff, me, userName, online, rollBusy)
     lineTrim(data, view) -> the dock's data without what the panel already says (the chase turn line, a news line of a chase round)
     isChasePrompt(p)   a question the panel answers (it is not drawn again as a card) */
import { chase as Rules } from "../../rules/index.mjs";
import { OBSTACLES, OUTCOMES } from "../flows/chase.mjs";
import { rollState } from "../desk-pure.mjs";
import { rollButtons, attrText } from "./model-pure.mjs";

export const LOOKS = Object.freeze(["A", "B", "C"]);
export const lookOf = (v) => (LOOKS.includes(String(v ?? "").toUpperCase()) ? String(v).toUpperCase() : "A");
export const CHASE_PROMPTS = Object.freeze(["chaseCatch", "chaseOption"]);
export const isChasePrompt = (p) => CHASE_PROMPTS.includes(p?.kind);
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const usersOf = (p) => (isObj(p?.to) && Array.isArray(p.to.users) ? p.to.users : []);
const ROLL_KEYS = Object.freeze(["obs:prey", "obs:pursuer", "prey", "pursuer"]);
/* how the obstacle reads, in our own words (the book's table is not copied): what it does to whom */
export const OBSTACLE_FX = Object.freeze(Object.fromEntries(OBSTACLES.map((id) => [id, `ITAC.chase.fx.${id}`])));

/* the GM reads the full state: the round's record as the view gives it to a player (view-pure instView) */
const fromCh = (c) => (isObj(c) ? { obstacle: c.obstacle ?? null, d66: c.d66 ?? null, chosen: c.chosen ? 1 : 0, from: c.distance ?? null, results: c.results ?? {}, over: c.over ?? null,
  prey: isObj(c.prey) ? { id: c.prey.id, roller: c.prey.roller, vehicle: c.prey.vehicle ? 1 : 0 } : null, pursuer: isObj(c.pursuer) ? { id: c.pursuer.id, roller: c.pursuer.roller, vehicle: c.pursuer.vehicle ? 1 : 0 } : null } : null);
/** The whole panel. */
export function chaseData(view, own, facts, t) {
  const ch = isObj(view?.chase) && view.kind === "chase" ? view.chase : null;
  if (!ch) return endedData(view, own, facts, t);
  const staff = !!facts.staff, me = facts.me, owns = new Set(staff ? [] : Object.keys(view.knowledge ?? {}));
  const name = (id) => (id ? facts.c?.(id)?.name ?? t("ITAC.Someone") : t("ITAC.Someone")), img = (id) => (id ? facts.c?.(id)?.img ?? null : null);
  const inst = (view.stack ?? []).find((i) => !i.masked && i.flow === "chase") ?? null, kids = inst ? (view.stack ?? []).filter((i) => !i.masked && i.parent === inst.id) : [];
  const info = inst?.data?.chase ?? fromCh(inst?.data?.ch), rolled = ch.rolled === view.round;
  const phase = inst ? "rolling" : rolled ? "after" : "before";
  /* the grants of the crew: one ranged attack each after the roll [B3438]; a used one is gone from the list (U172) */
  const crewOf = (pid) => { const g = (view.ledger?.[pid]?.grants ?? []).find((x) => x.kind === "chaseCrew"); return g ? (g.usedBy ? "used" : "open") : null; };
  const rollerOf = (side) => info?.[side]?.id ?? ((ch.sides?.[side] ?? []).length === 1 ? ch.sides[side][0] : null);
  const unit = (id, side) => {
    const c = facts.c?.(id) ?? null, veh = view.vehicles?.[id] ?? null, vehicle = c?.kind === "vehicle" || isObj(veh);
    const people = vehicle ? [veh?.driver ? { id: veh.driver, role: "driver" } : null, ...(veh?.crew ?? []).map((p) => ({ id: p, role: "passenger" }))].filter(Boolean) : [{ id, role: "self" }];
    return { id, side, name: name(id), img: img(id), vehicle, roller: rollerOf(side) === id, mine: people.some((p) => owns.has(p.id)),
      people: people.map((p) => ({ ...p, name: name(p.id), img: img(p.id), mine: owns.has(p.id), crew: crewOf(p.id), roleText: t(`ITAC.chase.role.${p.role}`) })) };
  };
  const sides = ["pursuer", "prey"].map((s) => { const units = (ch.sides?.[s] ?? []).map((u) => unit(u, s));
    return { id: s, label: t(`ITAC.ui.chase.${s}`), units, mine: units.some((u) => u.mine), roller: units.find((u) => u.roller) ?? units[0] ?? null }; });
  const mySide = sides.find((s) => s.mine)?.id ?? null;
  const seat = staff ? "gm" : sides.some((s) => s.units.some((u) => u.people.some((p) => p.mine && (p.role === "driver" || p.role === "self")))) ? "driver" : mySide ? "crew" : "aside";

  /* the rolls of the round: the chase's own and those of what it set off (the ram or charge on a catch) */
  const rowOf = (i, r) => { const st = rollState(r);
    return { inst: i.id, key: r.key, who: r.who, whoName: name(r.who), attr: r.attr ?? null, state: st, users: r.req?.users ?? [], rid: r.req?.rid ?? null, messageId: r.messageId ?? null, sixes: r.forced?.sixes ?? r.sixes ?? null,
      pushed: r.pushed ?? 0, dice: r.req?.dice ?? r.pool?.total ?? null, askReq: staff && st === "owed" && r.req ? { op: "askRoll", inst: i.id, roll: r.key } : null,
      acceptReq: staff && st === "push" ? { op: "setSixes", inst: i.id, roll: r.key, sixes: r.sixes, accept: true, pushed: r.pushed ?? 0 } : null }; };
  const rolls = [...(inst ? ROLL_KEYS.filter((k) => inst.rolls?.[k]).map((k) => rowOf(inst, inst.rolls[k])) : []), ...kids.flatMap((i) => Object.values(i.rolls ?? {}).map((r) => ({ ...rowOf(i, r), catch: 1 })))];
  const mineRoll = (r) => r.users.includes(me) || (staff && r.users.includes("gm"));
  const sideRoll = (side) => {
    const r = rolls.find((x) => x.key === side);
    const auto = side === "prey" && (info?.obstacle ?? (phase === "after" ? ch.last?.obstacle : null)) === "deadEnd";
    if (phase === "after" && !r) { const n = ch.last?.[side]; return { state: auto ? "auto" : n == null ? "none" : "done", sixes: n ?? null, text: auto ? t("ITAC.chase.roll.auto") : n == null ? "" : t("ITAC.chase.roll.sixes", { n }) }; }
    if (!r) return { state: auto && phase === "rolling" ? "auto" : "none", sixes: null, text: auto && phase === "rolling" ? t("ITAC.chase.roll.auto") : "" };
    const buttons = rollButtons(r, facts, t);
    return { state: r.state, sixes: r.sixes, dice: r.dice, who: r.who, whoName: r.whoName, mine: mineRoll(r), pushed: r.pushed, buttons,
      text: r.state === "owed" ? t("ITAC.chase.roll.owed", { dice: r.dice ?? "?" }) : t(r.pushed ? "ITAC.chase.roll.pushed" : "ITAC.chase.roll.sixes", { n: r.sixes ?? 0 }) };
  };
  for (const s of sides) s.roll = sideRoll(s.id);

  /* the obstacle of the round: being met now, or the one of the round just played */
  const obsId = phase === "rolling" ? info?.obstacle ?? null : phase === "after" ? ch.last?.obstacle ?? null : null;
  const obsRolls = rolls.filter((r) => r.key.startsWith("obs:")).map((r) => ({ side: r.key.slice(4), state: r.state, sixes: r.sixes, whoName: r.whoName, attr: attrText(t, r.attr), buttons: rollButtons(r, facts, t), mine: mineRoll(r) }));
  const obstacle = obsId ? { id: obsId, name: t(`ITAC.ui.chase.obstacle.${obsId}`, {}, obsId), fx: t(OBSTACLE_FX[obsId] ?? "ITAC.chase.fx.clear"), d66: info?.d66 ?? null, chosen: !!info?.chosen,
    clear: obsId === "clear", rolls: obsRolls, tag: info?.chosen ? t("ITAC.chase.obstacle.chosen") : info?.d66 ? t("ITAC.chase.obstacle.d66", { n: info.d66 }) : null } : null;
  const obsOn = !!ch.obstacles || !!obsId;

  /* where the round stands: the beats in the book's order [B3432-3442] */
  const step = inst?.step ?? null, preyDone = ["done", "auto"].includes(sides[1].roll.state), purDone = sides[0].roll.state === "done";
  const caughtNow = phase === "after" ? !!ch.last?.caught : ["catch", "crew", "close"].includes(step) && (ch.distance ?? 1) <= 0;
  const crewList = sides.flatMap((s) => s.units.flatMap((u) => u.people.filter((p) => p.crew).map((p) => ({ ...p, side: s.id }))));
  const crewOpen = crewList.filter((p) => p.crew === "open");
  const beat = (id, state, text = "", extra = {}) => ({ id, label: t(`ITAC.chase.beat.${id}`), state, text, ...extra });
  const order = ["obstacle", "prey", "pursuer", "result", "catch", "crew"];
  const nowAt = phase === "before" ? -1 : phase === "after" ? (crewOpen.length ? order.indexOf("crew") : order.length)
    : ["check", "obstacle"].includes(step) ? 0 : step === "movement" ? (preyDone ? 2 : 1) : step === "result" ? 3 : step === "catch" ? 4 : 5;
  const stateAt = (id) => { const k = order.indexOf(id); return nowAt < 0 ? "next" : k < nowAt ? "done" : k === nowAt ? "now" : "next"; };
  const result = phase === "after" && ch.last ? resultOf(ch, t) : null;
  const beats = [
    obsOn ? beat("obstacle", stateAt("obstacle"), obstacle ? obstacle.name : phase === "before" ? t("ITAC.chase.obstacle.next") : "") : null,
    beat("prey", stateAt("prey"), sides[1].roll.text, { who: sides[1].roller?.name ?? "" }),
    beat("pursuer", stateAt("pursuer"), sides[0].roll.text, { who: sides[0].roller?.name ?? "" }),
    beat("result", stateAt("result"), result?.short ?? ""),
    caughtNow || (phase === "rolling" && step === "catch") ? beat("catch", stateAt("catch"), t(sides[0].roller?.vehicle ? "ITAC.chase.catch.ram" : "ITAC.chase.catch.charge")) : null,
    crewList.length ? beat("crew", phase === "after" ? (crewOpen.length ? "now" : "done") : stateAt("crew"), crewOpen.length ? t("ITAC.chase.crew.left", { n: crewOpen.length }) : phase === "after" ? t("ITAC.chase.crew.none") : "") : null,
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
      text: r.state === "push" ? t("ITAC.chase.do.pushText", { n: r.sixes ?? 0 }) : obs ? t("ITAC.chase.do.obstacleText", { attr: attrText(t, r.attr), dice: r.dice ?? "?" }) : t(`ITAC.chase.do.rollText.${r.key === "prey" ? "prey" : "pursuer"}`, { dice: r.dice ?? "?" }),
      buttons: rollButtons(r, facts, t).map((b) => ({ ...b, primary: b.id === "roll" || b.id === "accept" })), sixes: r.sixes, dice: r.dice, state: r.state };
  } else if (!inst && crewOpen.some((p) => p.mine)) {
    const p = crewOpen.find((x) => x.mine);
    decision = { kind: "crew", mine: true, title: t("ITAC.chase.do.crew", { name: p.name }), text: t("ITAC.chase.do.crewText"),
      buttons: [{ id: `shoot:${p.id}`, label: t("ITAC.action.shoot"), primary: true, arm: { sel: p.id, action: "shoot" } }] };
  }
  /* who else the table waits for (a GM may settle it) */
  const waits = [...prompts.filter((p) => !forMe(p)).map((p) => ({ id: p.id, text: `${who(p.to === "gm" ? ["gm"] : usersOf(p), p.about)}: ${t(`ITAC.prompt.${p.kind}`)}`,
      buttons: staff ? [...answer(p, true).map((b) => ({ ...b, primary: false, label: t("ITAC.chase.for", { what: b.label }) })), ...(usersOf(p).length ? [{ id: `nudge:${p.id}`, label: t("ITAC.chase.nudge"), req: { op: "nudge", prompt: p.id } }] : [])] : [] })),
    ...rolls.filter((r) => r.state !== "done" && !mineRoll(r)).map((r) => ({ id: `${r.inst}:${r.key}`, text: `${who(r.users, r.who)}: ${t(r.state === "push" ? "ITAC.chase.wait.push" : "ITAC.chase.wait.roll")}`,
      buttons: staff ? [...rollButtons(r, facts, t), ...(r.users.some((u) => u !== "gm") ? [{ id: `nudge:${r.inst}:${r.key}`, label: t("ITAC.chase.nudge"), req: { op: "nudge", inst: r.inst, roll: r.key } }] : [])] : [] }))];
  if (!inst && crewOpen.some((p) => !p.mine)) waits.push({ id: "crew", text: t("ITAC.chase.wait.crew", { names: crewOpen.filter((p) => !p.mine).map((p) => p.name).join(", ") }), buttons: [], optional: true });

  /* the GM's controls: the next roll (with the obstacle the GM may name), the distance, the table, the ends */
  const busy = (view.stack ?? []).length > 0;
  const escaped = !!ch.over || ch.distance > ch.lostAt, caught = ch.distance <= 0;
  let gm = null;
  if (staff) {
    const pick = OBSTACLES.includes(own?.obstacle) ? own.obstacle : "auto";
    gm = {
      roll: { label: t(rolled ? "ITAC.chase.gm.next" : "ITAC.chase.gm.roll", { n: (ch.round ?? 0) + 1 }), disabled: busy ? t("ITAC.reason.busy") : escaped ? t("ITAC.chase.gm.over") : null,
        req: busy || escaped ? null : { op: "chaseRound", ...(pick !== "auto" ? { obstacle: pick } : {}) } },
      obstacle: { label: t("ITAC.chase.gm.obstacle"), value: pick, choices: [{ id: "auto", label: t(ch.obstacles ? "ITAC.chase.gm.table" : "ITAC.chase.gm.none") }, ...OBSTACLES.map((id) => ({ id, label: t(`ITAC.ui.chase.obstacle.${id}`, {}, id) }))] },
      table: { label: t("ITAC.ui.chase.obstacles"), on: !!ch.obstacles, req: { op: "chaseSet", obstacles: !ch.obstacles } },
      distance: { label: t("ITAC.ui.chase.distance"), value: ch.distance, minus: ch.distance > 0 ? { op: "chaseSet", distance: ch.distance - 1 } : null, plus: ch.distance < 99 ? { op: "chaseSet", distance: ch.distance + 1 } : null, tip: t("ITAC.chase.gm.distanceTip") },
      ends: OUTCOMES.map((o) => ({ id: o, label: t(`ITAC.chase.end.do.${o}`), tip: t(`ITAC.chase.end.tip.${o}`), disabled: busy ? t("ITAC.reason.busy") : null, req: busy ? null : { op: "chaseEnd", outcome: o },
        primary: (o === "escaped" && escaped) || (o === "combat" && caught && phase === "after") })),
    };
    if (!decision && !inst) decision = { kind: "gmRoll", mine: true, title: escaped ? t("ITAC.chase.gm.overTitle") : t(rolled ? "ITAC.chase.gm.nextTitle" : "ITAC.chase.gm.rollTitle", { n: (ch.round ?? 0) + 1 }),
      text: escaped ? t("ITAC.chase.gm.overText") : crewOpen.length ? t("ITAC.chase.gm.crewText", { names: crewOpen.map((p) => p.name).join(", ") }) : t("ITAC.chase.gm.rollText"),
      buttons: escaped ? gm.ends.filter((b) => b.id === "escaped").map((b) => ({ ...b, primary: true })) : [{ id: "gm:roll", label: gm.roll.label, primary: true, disabled: gm.roll.disabled, req: gm.roll.req }] };
  }

  /* the distance: how near escape and capture are (the gap counts zones; the prey is lost when it EXCEEDS lostAt [B3436]) */
  const d = Math.max(0, Number(ch.distance) || 0), L = Math.max(1, Number(ch.lostAt) || Rules.CHASE_END_DISTANCE);
  const status = caught ? { id: "caught", text: t("ITAC.ui.chase.caught"), tone: "hit" } : escaped ? { id: "escaped", text: t("ITAC.ui.chase.escaped"), tone: "miss" } : { id: "run", text: t("ITAC.ui.chase.apart", { n: d }), tone: null };
  const toEscape = escaped ? 0 : L + 1 - d, toCatch = d;
  return {
    on: true, seat, mySide, phase, round: ch.round ?? 0, title: t("ITAC.ui.chase"),
    roundLabel: phase === "before" ? t("ITAC.chase.round.before", { n: (ch.round ?? 0) + 1 }) : t("ITAC.chase.round.n", { n: phase === "rolling" ? (ch.round ?? 0) + 1 : ch.round ?? 0 }),
    distance: { value: d, lostAt: L, max: L + 1, status, toEscape, toCatch, from: phase === "after" ? ch.last?.from ?? null : null,
      say: caught ? t("ITAC.chase.say.caught") : escaped ? t("ITAC.chase.say.escaped") : t("ITAC.chase.say.run", { catch: toCatch, escape: toEscape }),
      escapeText: t("ITAC.chase.escapeAt", { n: L + 1 }), catchText: t("ITAC.chase.catchAt"), unit: t("ITAC.chase.zones", { n: d }) },
    sides, obstacle, beats, result, decision, waits, gm,
    you: seat === "gm" ? null : seat === "aside" ? t("ITAC.chase.you.aside") : t(`ITAC.chase.you.${seat}.${mySide}`),
    labels: { waiting: t("ITAC.ui.waitingFor"), round: t("ITAC.chase.label.round"), obstacle: t("ITAC.chase.beat.obstacle"), gm: t("ITAC.chase.label.gm"), ends: t("ITAC.chase.label.ends"), crew: t("ITAC.chase.label.crew"), fold: t("ITAC.chase.fold"), unfold: t("ITAC.chase.unfold") },
  };
}

/** what one round came to, from state.chase.last */
export function resultOf(ch, t) {
  const l = ch.last ?? {}, from = Number.isFinite(l.from) ? l.from : null, to = ch.distance, moved = from == null ? 0 : to - from;
  const head = l.escaped ? t("ITAC.chase.res.escaped") : l.caught ? t("ITAC.chase.res.caught") : l.winner ? t(`ITAC.chase.res.win.${l.winner}`, { n: Math.abs(moved) }) : t("ITAC.chase.res.tie");
  return { winner: l.winner ?? null, from, to, moved, caught: !!l.caught, escaped: !!l.escaped, head, short: from == null ? head : `${head} (${from} > ${to})`,
    rolls: l.prey == null && l.pursuer == null ? null : { prey: l.prey ?? 0, pursuer: l.pursuer ?? 0 } };
}

/** the card every seat sees once the chase is over (engine-pure chaseEnd writes state.chaseEnded) */
function endedData(view, own, facts, t) {
  const e = isObj(view?.chaseEnded) ? view.chaseEnded : null;
  if (!e || Number(own?.endSeen) === Number(e.n)) return null;
  const name = (id) => facts.c?.(id)?.name ?? t("ITAC.Someone"), out = OUTCOMES.includes(e.outcome) ? e.outcome : "combat";
  return { on: false, ended: { n: e.n, outcome: out, title: t(`ITAC.chase.end.${out}`), text: t(`ITAC.chase.end.text.${out}`, { n: e.rounds ?? 0, d: e.distance ?? 0 }),
    sides: ["pursuer", "prey"].map((s) => ({ id: s, label: t(`ITAC.ui.chase.${s}`), names: (e.sides?.[s] ?? []).map(name).join(", ") })),
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
  /* the line's "waiting for" names only what the panel does not: nothing, while every open question and owed roll is the chase's */
  const open = Object.values(view.prompts ?? {}).filter((p) => !p.answered), owed = (view.stack ?? []).filter((i) => !ours.has(i.id) && Object.values(i.rolls ?? {}).some((r) => rollState(r) !== "done"));
  if (open.every((p) => chaseIds.has(p.id)) && !owed.length) out.waiting = [];
  return out;
}
