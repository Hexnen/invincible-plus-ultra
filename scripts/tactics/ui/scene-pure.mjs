/* Tactical combat, the surfaces: the SCENE tab of the GM desk (P7) as render data. NO Foundry or browser globals (node-tested in check-ui.mjs).
   What stands in the fight without a card and what the GM does with it: a chase (start it, roll its rounds, end it), the vehicles (who sits
   where, the state of the machine) and the challenges (a book preset, what the GM still runs by hand). Staff only: built from the full state.
     sceneData(state, own, facts, t) -> { chase, vehicles, challenges, empty }
   facts.special() -> [{ id, name, kind: "challenge" | "vehicle", health?, maxHealth?, resolve?, maxResolve?, vehicle?, timeUnit? }]
   own = the desk's draft of a chase not started yet: { side: { [unit]: "prey" | "pursuer" }, distance, obstacles }
   Every control carries the request it sends; nothing here decides a rule (the executor refuses what is not allowed). */
import { PRESETS } from "../flows/challenge.mjs";
import { vehOf, rideOf } from "../flows/vehicle.mjs";
import { chaseOf, SIDES } from "../flows/chase.mjs";

const int = (x, lo, hi, dflt) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Math.trunc(Number(x)))) : dflt);
const nameOf = (facts, id, t) => facts.c?.(id)?.name ?? t("ITAC.Someone");

function chaseData(state, own, facts, t, machines) {
  const ch = chaseOf(state), busy = (state.stack ?? []).length > 0;
  const unitName = (u) => { const m = machines.find((x) => x.id === u), d = m ? vehOf(state, u).driver : null; return m && d ? t("ITAC.ui.chase.driven", { vehicle: m.name, name: nameOf(facts, d, t) }) : nameOf(facts, u, t); };
  if (ch) {
    const l = ch.last ?? null, crew = ch.crew?.round === state.round ? ch.crew.ids ?? [] : [];
    const last = !l ? null : [l.obstacle && l.obstacle !== "clear" ? t(`ITAC.ui.chase.obstacle.${l.obstacle}`, {}, String(l.obstacle)) : null,
      l.prey == null && l.pursuer == null ? null : t("ITAC.ui.chase.rolls", { prey: l.prey ?? 0, pursuer: l.pursuer ?? 0 }),
      t("ITAC.ui.chase.moved", { from: l.from ?? "?", to: ch.distance })].filter(Boolean);
    return {
      on: true, title: t("ITAC.ui.chase"), headline: t("ITAC.ui.chase.apart", { n: ch.distance }), lost: t("ITAC.ui.chase.lostAt", { n: ch.lostAt }), round: ch.round ? t("ITAC.ui.chase.round", { n: ch.round }) : t("ITAC.ui.chase.notRolled"),
      state: ch.distance <= 0 ? { text: t("ITAC.ui.chase.caught"), tone: "hit" } : ch.over || ch.distance > ch.lostAt ? { text: t("ITAC.ui.chase.escaped"), tone: "miss" } : null,
      sides: SIDES.map((s) => ({ id: s, label: t(`ITAC.ui.chase.${s}`), units: (ch.sides?.[s] ?? []).map((u) => ({ id: u, name: unitName(u) })) })), last,
      crew: crew.filter((id) => facts.c?.(id)).map((id) => ({ id, name: nameOf(facts, id, t), tip: t("ITAC.ui.chase.act") })), crewLabel: t("ITAC.ui.chase.crew"),
      distance: { id: `chase:distance:${ch.round ?? 0}:${ch.distance}`, label: t("ITAC.ui.chase.distance"), value: ch.distance, min: 0, max: 99, req: (v) => ({ op: "chaseSet", distance: v }) },
      obstacles: { label: t("ITAC.ui.chase.obstacles"), choices: [{ id: "off", label: t("ITAC.ui.off"), on: !ch.obstacles, req: { op: "chaseSet", obstacles: false } }, { id: "on", label: t("ITAC.ui.on"), on: !!ch.obstacles, req: { op: "chaseSet", obstacles: true } }] },
      roll: { label: t("ITAC.ui.chase.roll"), disabled: busy ? t("ITAC.reason.busy") : null, req: busy ? null : { op: "chaseRound" } },
      end: [{ id: "combat", label: t("ITAC.ui.chase.toFight"), req: { op: "chaseEnd", outcome: "combat" } }, { id: "escaped", label: t("ITAC.ui.chase.over"), req: { op: "chaseEnd", outcome: ch.distance <= 0 ? "caught" : "escaped" } }]
        .map((b) => ({ ...b, disabled: busy ? t("ITAC.reason.busy") : null, req: busy ? null : b.req })),
    };
  }
  /* not running: who flees and who follows. A rider is not listed, the vehicle with somebody at the wheel is */
  const people = Object.keys(state.ledger ?? {}).filter((id) => facts.c?.(id) && !rideOf(state, id)).map((id) => ({ id, name: nameOf(facts, id, t) }));
  const rides = machines.filter((m) => vehOf(state, m.id).driver && !vehOf(state, m.id).wrecked).map((m) => ({ id: m.id, name: unitName(m.id) }));
  const side = own.side ?? {}, units = [...rides, ...people].map((u) => ({ ...u, side: SIDES.includes(side[u.id]) ? side[u.id] : null }));
  const pick = (s) => units.filter((u) => u.side === s).map((u) => u.id), prey = pick("prey"), pursuer = pick("pursuer");
  const distance = int(own.distance, 0, 99, 1), obstacles = !!own.obstacles;
  const why = busy || state.phase !== "turns" ? t("ITAC.reason.busy") : !prey.length || !pursuer.length ? t("ITAC.ui.chase.needSides") : null;
  return {
    on: false, title: t("ITAC.ui.chase"), hint: t("ITAC.ui.chase.hint"),
    units: units.map((u) => ({ id: u.id, name: u.name, choices: [{ id: "none", label: t("ITAC.ui.chase.stays"), on: !u.side, side: null }, ...SIDES.map((s) => ({ id: s, label: t(`ITAC.ui.chase.${s}.one`), on: u.side === s, side: s }))] })),
    none: units.length ? null : t("ITAC.ui.chase.nobody"),
    distance: { label: t("ITAC.ui.chase.distance"), value: distance, min: 0, max: 99 },
    obstacles: { label: t("ITAC.ui.chase.obstacles"), choices: [{ id: "off", label: t("ITAC.ui.off"), on: !obstacles, value: false }, { id: "on", label: t("ITAC.ui.on"), on: obstacles, value: true }] },
    start: { label: t("ITAC.ui.chase.start"), disabled: why, req: why ? null : { op: "chaseStart", prey, pursuer, distance, obstacles } },
  };
}

function vehicleData(state, m, facts, t) {
  const r = vehOf(state, m.id), set = (patch) => ({ op: "vehicleSet", vehicle: m.id, ...patch }), v = m.vehicle ?? null;
  const seat = (id, role) => ({ id, name: nameOf(facts, id, t), role: t(`ITAC.ui.vehicle.${role}`), driver: role === "driver",
    out: { label: t("ITAC.ui.vehicle.out"), req: set({ seat: { who: id, role: null } }) },
    swap: role === "driver" ? null : { label: t("ITAC.ui.vehicle.toWheel"), req: set({ seat: { who: id, role: "driver" } }) } });
  const seats = [...(r.driver ? [seat(r.driver, "driver")] : []), ...r.crew.map((id) => seat(id, "passenger"))];
  const aboard = new Set(seats.map((s) => s.id));
  const free = Object.keys(state.ledger ?? {}).filter((id) => facts.c?.(id) && !aboard.has(id)).map((id) => ({ id, label: nameOf(facts, id, t), req: set({ seat: { who: id, role: r.driver ? "passenger" : "driver" } }) }));
  const tags = [r.wrecked ? { text: t("ITAC.ui.vehicle.wrecked"), tone: "miss" } : null, !r.wrecked && r.off?.engine ? { text: t("ITAC.ui.vehicle.engineOut"), tone: "miss" } : null,
    !r.wrecked && r.off?.weapon ? { text: t("ITAC.ui.vehicle.weaponOut"), tone: "miss" } : null, !r.wrecked && !r.off?.engine ? { text: t(r.started ? "ITAC.ui.vehicle.running" : "ITAC.ui.vehicle.stopped"), tone: r.started ? "hit" : null } : null].filter(Boolean);
  const flag = (id, on, patch) => ({ id, label: t(`ITAC.ui.vehicle.set.${id}`), on: !!on, req: set(patch(!on)) });
  return {
    id: m.id, name: m.name, tags,
    stats: [m.maxHealth != null ? t("ITAC.ui.vehicle.durability", { n: m.health ?? 0, max: m.maxHealth }) : null, v ? t("ITAC.ui.vehicle.speed", { n: v.speed }) : null, v ? t("ITAC.ui.vehicle.maneuver", { n: v.maneuver > 0 ? `+${v.maneuver}` : v.maneuver }) : null,
      v ? t("ITAC.ui.vehicle.seats", { n: seats.length, max: v.passengers + 1 }) : null].filter(Boolean),
    seats, empty: seats.length ? null : t("ITAC.ui.vehicle.empty"),
    board: free.length ? { id: `board:${m.id}`, label: t("ITAC.ui.vehicle.board"), choices: free } : null,
    flags: { label: t("ITAC.ui.vehicle.state"), items: [flag("started", r.started, (on) => ({ started: on })), flag("engineOff", r.off?.engine, (on) => ({ engineOff: on })), flag("weaponOff", r.off?.weapon, (on) => ({ weaponOff: on })), flag("wrecked", r.wrecked, (on) => ({ wrecked: on }))] },
  };
}

function challengeData(state, c, t) {
  const cfg = state.challenges?.[c.id] ?? null, unit = c.timeUnit ?? "rounds";
  const fx = (k) => t(`ITAC.ui.effect.${k}`, {}, String(k));
  return {
    id: c.id, name: c.name, over: !!cfg?.done || !(c.health > 0),
    stats: [t("ITAC.ui.challenge.rating", { n: c.health ?? 0 }), c.maxResolve > 0 ? t(`ITAC.ui.challenge.time.${unit}`, { n: c.resolve ?? 0 }, t("ITAC.ui.challenge.time.rounds", { n: c.resolve ?? 0 })) : t("ITAC.ui.challenge.noLimit"),
      cfg?.dice ? t("ITAC.ui.challenge.penalty", { n: cfg.dice }) : null].filter(Boolean),
    tag: cfg?.done || !(c.health > 0) ? { text: t("ITAC.ui.challenge.done"), tone: "hit" } : null,
    preset: { id: `preset:${c.id}`, label: t("ITAC.ui.challenge.preset"), value: cfg?.preset ?? "",
      choices: [{ id: "", label: t("ITAC.ui.challenge.noPreset"), req: { op: "challengeSetup", challenge: c.id, clear: true } }, ...PRESETS.map((p) => ({ id: p, label: t(`ITAC.ui.preset.${p}`, {}, p), req: { op: "challengeSetup", challenge: c.id, preset: p } }))] },
    objectives: (cfg?.objectives ?? []).map((o) => t(`ITAC.ui.objective.${o.id}`, {}, String(o.id))),
    manual: (cfg?.manual ?? []).length ? { label: t("ITAC.ui.challenge.byHand"), items: [...new Set(cfg.manual)].map(fx) } : null,
    hint: cfg ? null : t("ITAC.ui.challenge.hint"),
  };
}

/** Everything the Scene tab draws. */
export function sceneData(state, own, facts, t) {
  const special = facts.special?.() ?? [], machines = special.filter((x) => x.kind === "vehicle"), tasks = special.filter((x) => x.kind === "challenge");
  return {
    chase: chaseData(state ?? {}, own ?? {}, facts, t, machines),
    vehicles: { title: t("ITAC.ui.vehicles"), items: machines.map((m) => vehicleData(state ?? {}, m, facts, t)), empty: t("ITAC.ui.vehicles.empty") },
    challenges: { title: t("ITAC.ui.challenges"), items: tasks.map((c) => challengeData(state ?? {}, c, t)), empty: t("ITAC.ui.challenges.empty") },
  };
}
