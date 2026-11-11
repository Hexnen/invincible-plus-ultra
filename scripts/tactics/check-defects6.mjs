// node scripts/tactics/check-defects6.mjs -- the defects D90-D100 of dev/combat-defects.md ("Bug hunt 1") and the class behind D90 / D91:
// no throwing flow step and no failing write of the world, reachable by any request of a player or the GM, may leave the fight wedged or
// make an answer lie about what was saved. The table of the test kit can now FAIL (Table.failOn: a write that is rejected or refused; an
// actor that is gone answers as the real executor does), and every step of every flow can be made to throw (fault, below).
// The Foundry half of D95-D98 and D100 is in check-executor.mjs. Scripted table, no Foundry.
import { ok, eqc as eq, done, Table, seeded } from "./testkit.mjs";
import * as E from "./engine-pure.mjs";
import * as C from "./catalog-pure.mjs";
import * as R from "./relay-pure.mjs";
import * as J from "./journal-pure.mjs";
import * as Desk from "./desk-pure.mjs";
import * as Model from "./ui/model-pure.mjs";
import { EN, PL } from "./lang.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? (env.changed === false ? "ok(unchanged)" : "ok") : "?");
/* ---- faults: every step of every flow runs through here. fault.step(flow, step, inst) -> true: that step throws now */
const fault = { step: null, n: 0 };
for (const [fname, flow] of Object.entries(E.FLOWS)) for (const [k, fn] of Object.entries(flow.steps ?? {})) flow.steps[k] = (v, inst) => { if (fault.step?.(fname, k, inst)) { fault.n++; throw new Error(`injected: ${fname}.${k}`); } return fn(v, inst); };
const table = () => { const T = new Table(); T.hero("H1", "p1", { zone: "z1" }); T.hero("H2", "p2", { zone: "z1" }); T.npc("N1", { zone: "z1" }); T.npc("N2", { zone: "z2" }); T.order(["H1", "H2", "N1", "N2"]); return T; };
const docs = (T) => JSON.stringify(Object.values(T.c).map((c) => [c.id, c.health, c.resolve, c.crits, c.items, c.itemFlags ?? null, c.summonOf ?? null]));
const snap = (T) => JSON.stringify([T.state, T.log]);
/* every open transaction belongs to an instance of the stack */
const orphans = (T) => (T.state ? Object.keys(T.state.txOpen ?? {}).filter((id) => !T.state.stack.some((i) => i.tx === id)) : []);
/* the GM can always clear the table: abort whatever stands, top first, then move the turn on */
async function clear(T) {
  const out = [];
  for (let n = 0; n < 30 && T.state && T.top(); n++) out.push(code(await T.gm({ op: "abort", inst: T.top().id })));
  if (T.state && T.state.mode === "tactical" && T.state.phase === "turns" && !T.prompts().length) out.push(code(await T.gm({ op: "nextTurn", force: true })));   // (the end of a scene and a round's opening cards are the GM's to answer first, by design)
  return out;
}

/* ================================================================== D90: "Skip step" on an action that waits at its first step */
{
  const T = table();
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "move", to: "z2", exception: { text: "let me through" } } });
  await T.gm({ op: "answerFor", prompt: T.prompts("exception")[0].id, value: "grant" });
  const I0 = T.top();
  const env = await T.gm({ op: "skipStep", inst: I0.id });
  const I = T.top();
  eq([env.ok, env.parked, I?.id, I?.status, typeof I?.data?.failed?.step, !!I?.data?.failed?.msg], [true, I0.id, I0.id, "manual", "string", true], "D90: a step that throws answers ok, names the instance it handed to the GM (`parked`) and leaves it `manual` with what failed");
  eq([T.warns.length > 0, T.evs("stepFailed").length, T.evs("stepFailed").every((e) => e.gmOnly === 1)], [true, 1, true], "D90: the failure is reported to the host and as a GM-only event (no player is told of a step)");
  const later = [];
  for (const [who, req] of [["gm", { op: "setHealth", combatant: "N1", value: 3 }], ["gm", { op: "statusAdd", combatant: "N1", status: { id: "stunned" } }], ["p2", { op: "other", actor: "H2", text: "hello" }]]) later.push(code(await T.req(who, req)));
  ok(!later.includes("internal"), `D90: no later request answers internal (${later.join(", ")})`);
  eq(T.c.N1.health, 3, "D90: ... and what they asked for is there");
  const dm = Desk.deskModel(T.state, T.log, {});
  const m = dm.manual.find((x) => x.inst === I0.id || x.id === I0.id) ?? dm.manual[0];
  eq([dm.manual.length >= 1, m?.failed?.step === I.data.failed.step, m?.commands.map((c) => c.id)], [true, true, ["resolve", "abort"]], "D90: the GM's desk shows it as a card to settle by hand, with the step that failed and both ways out");
  const A = table(), B = table();
  for (const X of [A, B]) { await X.req("p1", { op: "declare", actor: "H1", decl: { action: "move", to: "z2", exception: { text: "x" } } }); await X.gm({ op: "answerFor", prompt: X.prompts("exception")[0].id, value: "grant" }); await X.gm({ op: "skipStep", inst: X.top().id }); }
  eq([code(await A.gm({ op: "manual", inst: A.top().id, result: { note: "moved by hand" } })), A.top() ?? null, orphans(A), Object.keys(A.state.txOpen ?? {}).length], ["ok", null, [], 0], "D90: `resolve by hand` closes the handed-over action and its transaction");
  eq([code(await B.gm({ op: "abort", inst: B.top().id })), B.top() ?? null, orphans(B)], ["ok", null, []], "D90: `abort` takes it off the stack");
  eq([code(await A.gm({ op: "nextTurn", force: true })), code(await B.gm({ op: "nextTurn", force: true }))], ["ok", "ok"], "D90: the round goes on after either");
}

/* ================================================================== D91: an exception granted for "get into a vehicle" without a vehicle */
{
  const T = table();
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "vehicleEnter", exception: { text: "the van is scenery" } } });
  const env = await T.gm({ op: "answerFor", prompt: T.prompts("exception")[0].id, value: "grant" });
  const I = T.top();
  eq([env.ok, env.parked ?? null, I?.status, I?.data?.failed ?? null, (I?.data?.notes ?? []).some((n) => n.note === "seatByHand" && n.why === "noVehicle")], [true, null, "manual", null, true], "D91: the granted seat without a vehicle is handed to the GM by the flow itself (by hand), nothing throws");
  eq(Desk.deskModel(T.state, T.log, {}).manual[0]?.byHand, "seat", "D91: the desk card says why it is the GM's");
  const later = [];
  for (const req of [{ op: "setResolve", combatant: "H1", value: 2 }, { op: "statusAdd", combatant: "N1", status: { id: "stunned" } }]) later.push(code(await T.gm(req)));
  eq(later, ["ok", "ok"], "D91: later requests are answered normally");
  eq([code(await T.gm({ op: "manual", inst: I.id, result: { note: "in the van" } })), T.top() ?? null, code(await T.gm({ op: "nextTurn", force: true }))], ["ok", null, "ok"], "D91: resolved by hand, the round goes on");
}

/* ================================================================== the class: invariants after ANY request, whatever failed inside it */
/* -> the list of broken invariants of one answered request */
function broken(T, env, b) {
  const out = [], c = code(env), stepThrew = fault.n > b.fault, hostThrew = b.host.thrown > b.thrown0, undoFailed = b.host.undoFailed > b.undo0;
  if (c === "internal" && !env.partial && (snap(T) !== b.snap || docs(T) !== b.docs)) out.push("`internal` without `partial`, but the state or a document changed");
  if (c === "internal" && !stepThrew && !hostThrew && !undoFailed) out.push(`internal with nothing injected (${env.error?.params?.msg})`);
  if (orphans(T).length) out.push(`open transaction nobody holds: ${orphans(T)}`);
  if (stepThrew && !(env.parked || env.partial || (c === "internal" && snap(T) === b.snap))) out.push("a step threw and the answer does not say so");
  if (hostThrew && !(env.parked || env.partial || env.failed?.length || (c === "internal" && snap(T) === b.snap && docs(T) === b.docs))) out.push("a write was rejected and the answer does not say so");
  if (undoFailed && !env.failed?.length && !env.partial && !env.parked) out.push("an inverse failed and the answer names nothing");
  if (env.failed && (!Array.isArray(env.failed) || env.failed.length > E.FAILED_MAX || env.failed.some((f) => typeof f.t !== "string"))) out.push("malformed `failed`");
  if (env.parked && T.state?.stack.find((i) => i.id === env.parked)?.status !== "manual") out.push("`parked` names an instance that is not the GM's");
  const w = R.wireEnv(env);
  if (!!w.partial !== !!env.partial || (w.failed?.length ?? 0) !== (env.failed?.length ?? 0) || (w.parked ?? null) !== (env.parked ?? null)) out.push("the wire loses partial / failed / parked");
  return out;
}
/* a table whose world can fail: host.mode(effect) -> "throw" | "refuse" | null, counted */
function failing(T) {
  const host = { mode: null, thrown: 0, undoFailed: 0 };
  T.failOn = (e) => { const m = host.mode?.(e) ?? null; if (m === "throw" && !e.undo) host.thrown++; if (m && e.undo) host.undoFailed++; return m; };
  return host;
}
const before = (T, host) => ({ snap: snap(T), docs: docs(T), fault: fault.n, host, thrown0: host.thrown, undo0: host.undoFailed });
const firstOpt = (p) => (p.multi ? [] : (p.options.find((o) => o.id === "pass" || o.id === "none") ?? p.options.find((o) => !o.disabled) ?? p.options[0])?.id ?? "pass");
/* play one declared action to its end as the GM would: rolls answered with `sixes`, every card with its first quiet option */
async function play(T, host, sixes, each) {
  for (let n = 0; n < 40 && T.state; n++) {
    const top = T.top(), rec = top && top.status !== "manual" ? Object.values(top.rolls ?? {}).find((x) => x.sixes == null && x.forced == null) : null, p = T.prompts()[0];
    if (!rec && !p) break;
    const b = before(T, host);
    const env = rec ? await T.roll(rec.key, sixes) : await T.gm({ op: "answerFor", prompt: p.id, value: firstOpt(p) });
    each(env, b, rec ? `roll ${rec.key}` : `answer ${p.kind}`);
    if (code(env) !== "ok") break;
  }
}

/* ---- (1) every step of the common actions throws once: a sweep over "the k-th step call of this action throws" */
{
  const DECLS = [{ action: "slugfest", targets: ["N1"] }, { action: "grapple", targets: ["N1"] }, { action: "orders", targets: ["N1"] }, { action: "scan", targets: ["N1"] }, { action: "banter", targets: ["N1"] }, { action: "usePower", targets: ["N1"] }, { action: "breakLift", targets: ["N1"] }, { action: "persuade", targets: ["N1"] }, { action: "pickUp", targets: ["N1"] }, { action: "shakeOff", targets: ["N1"] }, { action: "technology", targets: ["N1"] }];
  let cases = 0, parked = 0; const bad = [];
  for (const decl of DECLS) for (const sixes of [0, 2]) for (let k = 1; k <= 14; k++) {
    const T = table(), host = failing(T); let calls = 0, fired = false;
    fault.step = () => (++calls === k ? (fired = true) : false);
    const each = (env, b, what) => { for (const x of broken(T, env, b)) bad.push(`${decl.action} k=${k} ${what}: ${x}`); if (env.parked) parked++; };
    const b0 = before(T, host), env0 = await T.req("p1", { op: "declare", actor: "H1", decl });
    each(env0, b0, "declare");
    await play(T, host, sixes, each);
    fault.step = null;
    if (!fired) break;
    cases++;
    const out = await clear(T);
    if (out.some((c) => c !== "ok" && c !== "ok(unchanged)") || T.top()) bad.push(`${decl.action} k=${k}: the GM could not clear the table (${out})`);
    const again = code(await T.req("p2", { op: "declare", actor: T.state.init.curMember === "H2" ? "H2" : "H1", decl: { action: "other", text: "on we go" } }));
    if (again === "internal") bad.push(`${decl.action} k=${k}: the next declaration answers internal`);
  }
  eq(bad.slice(0, 5), [], `class (steps): no step that throws wedges the fight or makes an answer lie (${cases} cases, ${parked} handed to the GM)`);
  ok(cases > 30 && parked > 30, `class (steps): the sweep reached real steps (${cases} cases, ${parked} parked)`);
  console.log(`  step sweep: ${cases} cases, ${parked} handed to the GM`);
}

/* ---- (2) every write of the world is rejected once: "the k-th effect asked of the host throws / is refused" */
{
  const DECLS = [{ action: "slugfest", targets: ["N1"] }, { action: "grapple", targets: ["N1"] }, { action: "banter", targets: ["N1"] }, { action: "pickUp", targets: ["N1"] }];
  let cases = 0, said = 0; const bad = [];
  for (const mode of ["throw", "refuse"]) for (const decl of DECLS) for (let k = 1; k <= 30; k++) {
    const T = table(), host = failing(T); let calls = 0, fired = false;
    T.c.H1.resolve = 3; T.c.N1.health = 4;
    host.mode = (e) => (["dice", "rollRequest"].includes(e.t) ? null : ++calls === k ? ((fired = true), mode) : null);
    const each = (env, b, what) => { for (const x of broken(T, env, b)) bad.push(`${mode} ${decl.action} k=${k} ${what}: ${x}`); if (env.partial || env.failed || env.parked || code(env) === "internal") said++; };
    const b0 = before(T, host), env0 = await T.req("p1", { op: "declare", actor: "H1", decl });
    each(env0, b0, "declare");
    await play(T, host, 2, each);
    for (const req of [{ op: "hazard", hazard: { kind: "fire", intensity: 3 }, targets: ["N1", "H2"] }, { op: "setHealth", combatant: "N2", value: 2 }, { op: "setResolve", combatant: "H2", value: 2 }, { op: "nextTurn", force: true }, { op: "declare", actor: "H2", decl: { action: "slugfest", targets: ["N1"] } }, { op: "manual", result: { note: "x", damage: [{ target: "N1", amount: 1 }, { target: "N2", amount: 1 }], stress: [{ target: "H1", amount: 1 }] } }, { op: "nextRound", force: true }]) {
      if (!T.state) break;
      const b = before(T, host);
      each(await T.gm(req.op === "manual" ? { ...req, inst: T.top()?.id ?? "a0" } : req), b, req.op);
      await play(T, host, 2, each);
    }
    const closed = T.log.list.filter((t) => t.state === "closed").map((t) => t.id);
    for (const tx of closed.reverse().slice(0, 4)) { if (!T.state) break; const b = before(T, host); each(await T.gm({ op: "undo", tx, force: true }), b, "undo"); }
    host.mode = null;
    if (!fired) break;
    cases++;
    const out = await clear(T);
    if (out.some((c) => c !== "ok" && c !== "ok(unchanged)") || T.top()) bad.push(`${mode} ${decl.action} k=${k}: the GM could not clear the table (${out})`);
  }
  eq(bad.slice(0, 5), [], `class (writes): no rejected or refused write wedges the fight or makes an answer lie (${cases} cases, ${said} answers that said so)`);
  ok(cases > 10, `class (writes): the sweep reached real writes (${cases})`);
  console.log(`  write sweep: ${cases} cases, ${said} answers that said so`);
}

/* ---- (3) random walks with random faults (the adversary's fuzzer, with failures of steps and of the world mixed in) */
{
  const ACTIONS = Object.keys(C.BUILTIN), bad = []; let reqs = 0, steps = 0, writes = 0, inverses = 0, internals = 0, parks = 0, partials = 0;
  const SEEDS = Number(process.env.IPU_FUZZ_SEEDS ?? 60), LEN = Number(process.env.IPU_FUZZ_LEN ?? 90);
  for (let seed = 1; seed <= SEEDS && bad.length < 5; seed++) {
    const rnd = seeded(seed * 7919), pick = (a) => a[Math.floor(rnd() * a.length)], chance = (p) => rnd() < p;
    const T = new Table(), host = failing(T);
    T.hero("H1", "p1", { zone: "z1" }); T.hero("H2", "p2", { zone: pick(["z1", "z2"]) }); T.npc("N1", { zone: "z1" }); T.npc("N2", { zone: "z2", hidden: chance(0.3) }); T.npc("N3", { zone: "z1", kind: "minions", members: 3, health: 3 });
    try { T.order(["H1", "H2", "N1", "N2", "N3"]); } catch { continue; }
    const ids = () => Object.keys(T.c), owner = (cid) => T.c[cid]?.owners?.[0] ?? "gm", pStep = seed % 3 === 0 ? 0 : 0.15, pHost = seed % 3 === 1 ? 0 : 0.2;
    const trace = [];
    for (let i = 0; i < LEN && T.state && bad.length < 5; i++) {
      const r = rnd(), cur = T.state.init.curMember, top = T.top(), prompts = T.prompts(); let what = null, go = null;
      if (r < 0.24) { const actor = chance(0.8) && cur ? cur : pick(ids()), action = pick(ACTIONS), targets = chance(0.8) ? [pick(ids())] : chance(0.5) ? [pick(ids()), pick(ids())] : [];
        what = `declare ${action}`; go = () => T.req(chance(0.7) ? owner(actor) : pick(["p1", "p2", "gm"]), { op: "declare", actor, decl: { action, targets, ...(chance(0.2) ? { to: pick(["z1", "z2", "z3"]) } : {}), ...(chance(0.1) ? { fullAuto: true } : {}), ...(chance(0.15) ? { exception: { text: "pls" } } : {}) } }); }
      else if (r < 0.44 && prompts.length) { const q = pick(prompts), o = q.options.length ? pick(q.options).id : "x", value = q.multi ? (chance(0.5) ? [] : [o]) : chance(0.1) ? { id: o, n: 2, dice: 1 } : o;
        what = `answer ${q.kind}`; go = () => T.req(chance(0.6) ? "gm" : pick(["p1", "p2"]), { op: chance(0.7) ? "answerFor" : "answer", prompt: q.id, value }); }
      else if (r < 0.60 && top && Object.values(top.rolls ?? {}).some((x) => x.sixes == null && x.forced == null)) { const rec = Object.values(top.rolls).find((x) => x.sixes == null && x.forced == null); what = `roll ${rec.key}`; go = () => T.roll(rec.key, Math.floor(rnd() * 4), { pushable: chance(0.3) }); }
      else if (r < 0.67) { what = "endTurn"; go = () => (cur ? T.req(chance(0.5) ? owner(cur) : "gm", { op: "endTurn", actor: cur, ...(chance(0.3) ? { force: true } : {}) }) : T.gm({ op: "nextTurn" })); }
      else if (r < 0.71) { const op = pick(["nextTurn", "nextRound", "prevTurn"]); what = op; go = () => T.gm({ op, ...(chance(0.5) ? { force: true } : {}) }); }
      else if (r < 0.77) { const closed = T.log.list.filter((t) => t.state === "closed"); if (!closed.length) continue; const tx = pick(closed).id; what = "undo"; go = () => T.gm({ op: "undo", tx, ...(chance(0.4) ? { force: true, drift: pick(["restore", "difference", "leave", undefined]) } : {}) }); }
      else if (r < 0.81) { const gone = pick(ids()); if (ids().length <= 2) continue; if (chance(0.5)) { delete T.c[gone]; what = "leave"; } else { T.c[gone].defeated = !T.c[gone].defeated; what = "defeated"; } go = () => T.gm({ op: "roster" }); }
      else if (r < 0.87 && top) { const op = pick(["abort", "skipStep", "manual", "cancel", "goToStep", "askRoll", "setSixes", "setOutcome", "setDamage", "retarget"]), flow = E.FLOWS[top.flow]; what = `${op} ${top.flow}.${top.step}`;
        go = () => T.gm({ op, inst: top.id, step: pick(flow.STEPS), roll: pick([...Object.keys(top.rolls ?? {}), "attack"]), sixes: Math.floor(rnd() * 4), target: pick(ids()), targets: [pick(ids())], hit: chance(0.5), damage: Math.floor(rnd() * 5), result: chance(0.5) ? { note: "x", damage: [{ target: pick(ids()), amount: 1 }], stress: [{ target: pick(ids()), amount: 1 }] } : pick(["success", "fail"]), refund: chance(0.5) }); }
      else if (r < 0.91) { const c = pick(ids()); what = "setHealth"; go = () => T.gm({ op: pick(["setHealth", "setResolve"]), combatant: c, value: Math.floor(rnd() * 7) }); }
      else if (r < 0.94) { const c = pick(ids()); what = "status"; go = () => T.gm({ op: "statusAdd", combatant: c, status: { id: pick(["stunned", "grappled", "snared", "trapped", "unconscious", "dead", "burning"]), ...(chance(0.5) ? { by: pick(ids()) } : {}) } }); }
      else if (r < 0.96) { what = "hazard"; go = () => T.gm({ op: "hazard", hazard: { kind: pick(["fire", "fixed"]), intensity: 2, amount: 2 }, targets: [pick(ids()), pick(ids())] }); }
      else if (r < 0.98) { const c = pick(ids()); what = "forced"; go = () => T.gm({ op: pick(["forcedMove", "fall"]), target: c, combatant: c, distance: 2, levels: 1 }); }
      else { what = "endScene"; go = () => T.gm({ op: "endScene", force: chance(0.5) }); }
      const clean = chance(0.25);                                    // some requests run with nothing failing: they show whether an earlier failure left a wedge
      fault.step = clean ? null : () => rnd() < pStep;
      host.mode = clean ? null : (e) => (["dice", "rollRequest"].includes(e.t) ? null : rnd() < pHost ? (rnd() < 0.5 ? "throw" : "refuse") : null);
      const b = before(T, host);
      let env;
      try { env = await go(); } catch (e) { bad.push(`seed ${seed} step ${i} ${what}: the director threw (${String(e?.message ?? e).slice(0, 80)})`); break; }
      fault.step = null; host.mode = null;
      trace.push(what); reqs++;
      steps += fault.n - b.fault; writes += host.thrown - b.thrown0; inverses += host.undoFailed - b.undo0;
      if (code(env) === "internal") internals++;
      if (env?.parked) parks++;
      if (env?.partial) partials++;
      for (const x of broken(T, env ?? {}, b)) bad.push(`seed ${seed} step ${i} ${what}: ${x} :: ${trace.slice(-6).join(" > ")}`);
    }
    fault.step = null; host.mode = null;
    if (T.state) { const out = await clear(T); if (out.includes("internal") || out.includes("busy") || T.top()) bad.push(`seed ${seed}: the GM could not clear the table at the end (${out.slice(-4)}) ${JSON.stringify(T.last)} phase ${T.state?.phase} mode ${T.state?.mode} prompts ${JSON.stringify(T.prompts().map((p) => p.kind))} sched ${JSON.stringify(T.state?.sched)}`); }
  }
  eq(bad.slice(0, 5), [], `class (random walks): ${reqs} requests, ${steps} steps thrown, ${writes} writes rejected, ${inverses} inverses failed; ${parks} handed to the GM, ${partials} partial, ${internals} internal (each with nothing saved, or saying partial)`);
  ok(steps > 20 && writes > 20 && parks > 10, `class (random walks): the faults were reached (${steps} / ${writes} / ${parks})`);
  console.log(`  random walks: ${reqs} requests, ${steps} steps thrown, ${writes} writes rejected, ${inverses} inverses failed; ${parks} parked, ${partials} partial, ${internals} internal`);
}

/* ================================================================== a request that fails before it is through is taken back whole */
{
  const T = table(); await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
  const h0 = T.c.N1.health, s0 = snap(T), res = { damage: [{ target: "N1", amount: 2 }], stress: [{ target: "H2", amount: 1 }] };
  T.failOn = (e) => (e.path === "resolve" && !e.undo ? "throw" : null);
  let env = await T.gm({ op: "manual", inst: T.top().id, result: res });
  eq([code(env), env.changed, env.partial ?? null, env.failed ?? null, T.c.N1.health, snap(T) === s0], ["internal", false, null, null, h0, true], "rollback: the second write of a GM request is rejected: the first one is taken back, the state is as before, and `internal` is the whole truth");
  eq(T.performed.at(-1)?.undo, 1, "rollback: ... by asking the world for the inverse of what was already written");
  T.failOn = (e) => ((e.path === "resolve" && !e.undo) || e.undo ? "throw" : null);
  env = await T.gm({ op: "manual", inst: T.top().id, result: res });
  eq([code(env), env.partial, env.failed, T.c.N1.health, snap(T) === s0], ["internal", true, [{ t: "actor", reason: "error" }], h0 - 2, true], "rollback: when the inverse is rejected too, the answer says `partial` and names what stayed changed");
  eq([R.wireEnv(env).partial, R.wireEnv(env).failed], [true, [{ t: "actor", reason: "error" }]], "rollback: ... and that reaches the asking client");
  T.failOn = null;
  eq([code(await T.gm({ op: "manual", inst: T.top().id, result: res })), T.top() ?? null], ["ok", null], "rollback: the same request goes through once the world takes the writes");
}
/* ================================================================== D99 and the journal's failed list: an undo that could not undo says what stayed */
{
  const T = table(); await T.gm({ op: "setHealth", combatant: "N1", value: 3 }); await T.gm({ op: "setHealth", combatant: "N2", value: 2 });
  const [a, b] = T.log.list.map((t) => t.id);
  T.failOn = (e) => (e.undo ? "refuse" : null);
  let env = await T.gm({ op: "undo", tx: b });
  eq([code(env), env.undone, env.failed, T.c.N2.health, T.evs("undo").at(-1)?.failed], ["ok", [b], [{ tx: b, t: "actor", reason: "refused" }], 2, [{ t: "actor", reason: "refused" }]], "undo: an inverse the world refuses is named in the answer and in the journal's event; the document stays as it was");
  T.failOn = null; delete T.c.N1;                                   // the combatant (and its actor) left the world
  env = await T.gm({ op: "undo", tx: a, force: true });
  eq([code(env), env.failed], ["ok", [{ tx: a, t: "actor", reason: "gone" }]], "undo: an actor that is gone is no crash and no silence: `gone` (the kit now answers as the executor does)");
  const w = R.wireEnv({ ok: true, changed: true, partial: 1, parked: "a3", rev: 7, undone: [a, "__proto__", 5], failed: [...Array.from({ length: 30 }, (_, i) => ({ tx: `x${i}`, t: "actor", reason: "gone", secret: { deep: 1 } })), "junk", { t: 5 }] });
  eq([w.partial, w.parked, w.rev, w.undone, w.failed.length, w.failed[0], w.failed.every((f) => !("secret" in f))], [true, "a3", 7, [a], 20, { tx: "x0", t: "actor", reason: "gone" }, true], "D99: the wire keeps partial, parked, rev, undone and at most 20 clean rows of `failed`");
  eq([R.wireEnv({ ok: true, changed: true, parked: "__proto__", failed: "x", undone: "y" }).parked ?? null, "failed" in R.wireEnv({ ok: true, failed: "x" }), "partial" in R.wireEnv({ ok: true, changed: true })], [null, false, false], "D99: ... and nothing malformed, nothing when there is nothing");
}
/* ================================================================== what the asking user is told (U67: no executor wording for a player) */
{
  const tt = (lang) => (k, p = {}) => String(lang[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => p[x] ?? m);
  for (const [name, lang] of [["en", EN], ["pl", PL]]) {
    const t = tt(lang), env = { ok: true, changed: true, partial: true, failed: [{ t: "actor", reason: "gone" }, { t: "item+", reason: "gone" }, { t: "actor", reason: "error" }], parked: "a3" };
    const gm = Model.envNotes(env, t, true), pl = Model.envNotes(env, t, false);
    ok(gm.length === 2 && gm.every((s) => !/ITAC\./.test(s) && !/\{/.test(s)) && pl.length === 1 && pl[0] === lang["ITAC.warn.partialPlayer"], `notes (${name}): the GM reads what could not be changed and that an action waits on the desk; a player one plain sentence (${gm.length} / ${pl.length}: ${gm.join(" | ")})`);
    ok(!/engine|silnik|automat|executor|wykonawc|step|krok/i.test(pl[0]), `notes (${name}): the player's sentence names no machinery ("${pl[0]}")`);
    eq([Model.envNotes({ ok: true, changed: true }, t, true), Model.envNotes({ ok: false, error: { code: "illegal" } }, t, false), Model.envNotes({ ok: true, parked: "a1" }, t, false)], [[], [], []], `notes (${name}): nothing to say about an ordinary answer; a player is not told of a parked action`);
    for (const k of ["ITAC.ui.manual.failed", "ITAC.ui.manual.seat", "ITAC.journal.cutShort", "ITAC.warn.partial", "ITAC.warn.failed", "ITAC.warn.parked", ...["actor", "item", "effect", "token", "zones", "message", "summon", "sys", "other"].map((x) => `ITAC.failed.${x}`)]) ok(typeof lang[k] === "string" && lang[k].length > 2, `texts (${name}): ${k}`);
  }
}
/* ================================================================== D92: a combatant named twice is one target */
{
  const T = table();
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1", "N1"] } });
  eq(T.top()?.decl.targets, ["N1"], "D92: declare [N1, N1] -> one target");
  const n = R.normalize({ op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1", "N1", "N2", "N1"] } });
  eq((n?.req ?? n)?.decl?.targets, ["N1", "N2"], "D92: the relay names each id once");
  eq([code(await T.gm({ op: "retarget", inst: T.top().id, from: "N1", to: "N2" })), T.top()?.decl.targets], ["ok", ["N2"]], "D92: the GM's retarget leaves a list without doubles");
  await clear(T);
  const d0 = T.performed.filter((e) => e.t === "dice").length;
  await T.gm({ op: "hazard", hazard: { kind: "fire", intensity: 2 }, targets: ["N1", "N1", "H2"] });
  eq(T.performed.filter((e) => e.t === "dice").slice(d0).map((e) => e.why), ["fire:N1", "fire:H2"], "D92: a hazard on [N1, N1, H2] rolls once for each of the two");
  /* a card about nobody (a hazard's own revalidation) survives the store: found by the random walks; the kit's round-trip check is the guard */
  const T2 = table(); await T2.gm({ op: "hazard", hazard: { kind: "fixed", amount: 2 }, targets: ["N1"] });
  delete T2.c.N1; await T2.gm({ op: "roster" });
  ok(T2.prompts().every((p) => !("about" in p) || p.about != null), "no card carries a null `about` (a hazard's revalidation is about nobody)");
}
/* ================================================================== D94: the pool preview is keyed by the facts too */
{
  const d = { action: "slugfest", targets: ["N1"] };
  ok(Model.previewKey("c", 4, 1, "H1", d) !== Model.previewKey("c", 4, 2, "H1", d), "D94: the same declaration at the same state revision but other facts (a sheet changed) is another preview");
  eq([Model.previewKey("c", 4, 1, "H1", d) === Model.previewKey("c", 4, 1, "H1", { ...d }), Model.previewKey("c", 4, 1, "H1", d) !== Model.previewKey("c", 5, 1, "H1", d), Model.previewKey("c", 4, 1, "H1", d, ["N1"]) !== Model.previewKey("c", 4, 1, "H1", d, ["N2"])], [true, true, true], "D94: ... equal for equal input, other for another revision or another reach list");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./ui/main.mjs", import.meta.url), "utf8");
  ok((src.match(/key = previewKey\(combat\.id, view\?\.rev, factsRev, /g) ?? []).length === 2 && /const previewKey = Model\.previewKey;/.test(src), "D94: both caches of ui/main.mjs (pool and reach) build their key with previewKey");
}
done("check-defects6");
