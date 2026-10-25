// node scripts/session/check-session.mjs  -> prints "OK <n> checks" or exits 1.
import * as P from "./pure.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let n = 0; const fails = [];
const ck = (name, cond) => { n++; if (!cond) fails.push(name); };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
const eq = (name, a, b) => ck(`${name}: ${canon(a)} !== ${canon(b)}`, canon(a) === canon(b));
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };

/* ---- no Foundry globals */
const src = readFileSync(fileURLToPath(new URL("./pure.mjs", import.meta.url)), "utf8");
for (const g of ["game.", "foundry.", "ui.", "canvas.", "Hooks.", "CONFIG.", "document.", "window.", "fromUuid", "localStorage"])
  ck(`pure.mjs must not reference ${g}`, !new RegExp(`(^|[^\\w.])${g.replace(".", "\\.")}`, "m").test(src.replace(/\/\/.*$/gm, "").replace(/"[^"\n]*"/g, '""').replace(/`[^`]*`/g, "``")));

/* ---- question model */
eq("10 good", P.GOOD.length, 10); eq("6 bad", P.BAD.length, 6);
eq("ids unique", new Set(P.ALL_IDS).size, 16);
eq("flaw is 5th", P.GOOD[4].id, P.FLAW_ID); ck("only the flaw question is flaw", P.GOOD.filter((q) => q.flaw).length === 1 && !P.BAD.some((q) => q.flaw));
for (const q of [...P.GOOD, ...P.BAD]) { ck(`label ${q.key}`, typeof P.LABELS_EN[q.key] === "string" && P.LABELS_EN[q.key].length > 5 && P.LABELS_EN[q.key].length < 60); ck(`frozen ${q.id}`, Object.isFrozen(q)); }
eq("questions(false)", P.questions(false).length, 10); eq("questions(true)", P.questions(true).length, 16);
eq("questionById", P.questionById("b04").key, "wreckZone"); eq("questionById unknown", P.questionById("zz"), null); eq("questionById proto", P.questionById("__proto__"), null);

/* ---- fixtures */
const A = "AAAA", B = "BBBB", C = "CCCC", D = "DDDD";
const GM = { id: "gm1", staff: true }, P1 = { id: "pl1", staff: false }, P2 = { id: "pl2", staff: false }, P3 = { id: "pl3", staff: false };
const OWN = { [A]: ["pl1"], [B]: ["pl2"], [C]: ["pl1", "pl2"], [D]: [] };
const ctxFor = (user, now = 1000) => ({ user, now, owns: (h) => (OWN[h] ?? []).includes(user.id) });
const heroes = [{ id: A, name: "Alpha" }, { id: B, name: "Beta" }, { id: C, name: "Gamma" }];
const R = (s, a, user = GM, now = 1000) => P.reduce(s, a, ctxFor(user, now));
const must = (name, r) => { ck(`${name} ok`, r.ok === true); return r.session; };
const fail = (name, r, code) => { ck(`${name} fails`, r.ok === false); eq(`${name} code`, r.error?.code, code); if (r.error) ck(`${name} key`, r.error.key === `IPL.Session.err.${code}`); };

/* ---- start */
fail("start by player", R(null, { type: "start", id: "s1", heroes }, P1), "noPermission");
fail("start no heroes", R(null, { type: "start", id: "s1", heroes: [] }), "noHeroes");
fail("start junk heroes", R(null, { type: "start", id: "s1", heroes: [null, 5, { id: "__proto__" }, { id: "a b" }] }), "noHeroes");
let s = must("start", R(null, { type: "start", id: "s1", heroes: [...heroes, { id: A, name: "dup" }] }));
eq("start state", s.state, "open"); eq("start heroes dedup", s.heroes.map((h) => h.id), [A, B, C]); eq("start index", s.index, 0); eq("start askBad", s.askBad, false);
eq("start rev", s.rev, 1); eq("start gm", s.gm, "gm1"); eq("start log", s.log.length, 1);
fail("start twice", R(s, { type: "start", id: "s2", heroes }), "exists");
eq("start with discarded ok", R({ ...s, state: "discarded" }, { type: "start", id: "s2", heroes }).ok, true);
eq("start askBad", must("sb", R(null, { type: "start", id: "s3", heroes, askBad: true })).askBad, true);
eq("start 30 heroes capped", must("s30", R(null, { type: "start", id: "s4", heroes: Array.from({ length: 30 }, (_, i) => ({ id: "h" + i, name: "H" })) })).heroes.length, P.LIMITS.heroes);
fail("action null", P.reduce(s, null, ctxFor(GM)), "badInput");
fail("action unknown type", R(s, { type: "explode" }), "badInput");
fail("ctx missing", P.reduce(s, { type: "next" }, {}), "noPermission");
fail("ctx bad user id", P.reduce(s, { type: "next" }, { user: { id: "__proto__", staff: true } }), "noPermission");
fail("no session", R(null, { type: "next" }), "noSession");
fail("wrong schema", R({ ...s, v: 9 }, { type: "next" }), "noSession");

/* ---- navigation */
fail("player next", R(s, { type: "next" }, P1), "noPermission");
fail("player setQuestion", R(s, { type: "setQuestion", index: 3 }, P1), "noPermission");
let t = must("next", R(s, { type: "next" })); eq("next index", t.index, 1); eq("rev bumps", t.rev, 2);
eq("prev at 0 range", R(s, { type: "prev" }).error?.code, "range");
t = must("prev", R(t, { type: "prev" })); eq("prev index", t.index, 0);
t = must("jump 9", R(s, { type: "setQuestion", index: 9 })); eq("jump", t.index, 9);
t = must("jump 10 (summary)", R(s, { type: "setQuestion", index: 10 })); eq("summary index", t.index, 10); eq("view summary", P.view(t), "summary");
fail("jump 11 range", R(s, { type: "setQuestion", index: 11 }), "range");
fail("jump -1 range", R(s, { type: "setQuestion", index: -1 }), "range");
fail("jump NaN", R(s, { type: "setQuestion", index: NaN }), "badInput");
fail("jump string", R(s, { type: "setQuestion", index: "3" }), "badInput");
fail("jump float", R(s, { type: "setQuestion", index: 1.5 }), "badInput");
eq("jump same unchanged", R(s, { type: "setQuestion", index: 0 }).changed, false);
fail("next past summary", R(t, { type: "next" }), "range");
eq("view question", P.view(s), "question"); eq("view none", P.view(null), "none");
eq("currentQuestion 0", P.currentQuestion(s).id, "q01"); eq("currentQuestion summary", P.currentQuestion(t), null);
const sb = must("sb2", R(null, { type: "start", id: "s5", heroes, askBad: true }));
eq("bad total", P.total(sb), 16); eq("jump 15 bad q", P.currentQuestion(must("j", R(sb, { type: "setQuestion", index: 15 }))).id, "b06");
fail("jump 17 bad range", R(sb, { type: "setQuestion", index: 17 }), "range");

/* ---- permissions matrix (exhaustive: users x heroes x questions x states) */
const users = [GM, P1, P2, P3];
const states = {
  open0: s, open4: must("o4", R(s, { type: "setQuestion", index: 4 })), closed: must("cl", R(s, { type: "close" })), discarded: { ...s, state: "discarded" },
  gmLocked: must("gl", R(s, { type: "setAnswer", hero: A, q: "q01", value: 0 }))
};
for (const [name, st] of Object.entries(states)) {
  for (const u of users) for (const h of [A, B, C, D, "ZZZZ"]) for (const q of ["q01", "q05", "q10", "b01", "zz"]) {
    const ctx = ctxFor(u);
    const inSess = st.heroes.some((x) => x.id === h);
    const qOk = P.questions(st.askBad).some((x) => x.id === q);
    const cur = P.currentQuestion(st);
    let expect = false;
    if (st.state === "open" && inSess && qOk) {
      if (u.staff) expect = true;
      else if ((OWN[h] ?? []).includes(u.id) && cur?.id === q && !P.cellOf(st, q, h)?.g) expect = true;
    }
    ck(`canAnswer ${name} ${u.id} ${h} ${q}`, P.canAnswer(ctx, st, h, q) === expect);
    // the reducer must agree with canAnswer
    const r = P.reduce(st, { type: "setAnswer", hero: h, q, value: 1 }, ctx);
    if (expect) ck(`reduce allows ${name} ${u.id} ${h} ${q}`, r.ok === true); else ck(`reduce denies ${name} ${u.id} ${h} ${q}`, r.ok === false);
  }
  for (const u of users) ck(`canNavigate ${name} ${u.id}`, P.canNavigate(ctxFor(u), st) === (u.staff && st.state === "open"));
}
ck("canView everyone", users.every((u) => P.canView(ctxFor(u)))); ck("canView none", !P.canView({}) && !P.canView(null));
ck("canManage", P.canManage(ctxFor(GM)) && !P.canManage(ctxFor(P1)));
ck("no owns fn denies", !P.canAnswer({ user: P1 }, s, A, "q01"));
ck("owns returns truthy non-true denies", !P.canAnswer({ user: P1, owns: () => "yes" }, s, A, "q01"));
ck("staff flag must be literally true", !P.canNavigate({ user: { id: "x", staff: "yes" } }, s));
const shared = must("c-p1", R(s, { type: "setAnswer", hero: C, q: "q01", value: 1 }, P1)); const shared2 = must("c-p2", R(shared, { type: "setAnswer", hero: C, q: "q01", value: 0 }, P2));
eq("hero with two owners: either may set", P.cellValue(shared2, "q01", C), 0);
fail("player on non-current q", R(s, { type: "setAnswer", hero: A, q: "q02", value: 1 }, P1), "notCurrent");
fail("player on others hero", R(s, { type: "setAnswer", hero: B, q: "q01", value: 1 }, P1), "noPermission");
fail("player on unowned hero", R(s, { type: "setAnswer", hero: D, q: "q01", value: 1 }, P1), "unknownHero");
fail("unknown question", R(s, { type: "setAnswer", hero: A, q: "q99", value: 1 }), "unknownQuestion");
fail("bad question when askBad off", R(s, { type: "setAnswer", hero: A, q: "b01", value: 1 }), "unknownQuestion");
fail("value 3", R(s, { type: "setAnswer", hero: A, q: "q01", value: 3 }), "badInput");
fail("value true", R(s, { type: "setAnswer", hero: A, q: "q01", value: true }), "badInput");
fail("value string", R(s, { type: "setAnswer", hero: A, q: "q01", value: "1" }), "badInput");
fail("value 2 on non-flaw", R(s, { type: "setAnswer", hero: A, q: "q01", value: 2 }), "badInput");
fail("hero proto", R(s, { type: "setAnswer", hero: "__proto__", q: "q01", value: 1 }), "badInput");
fail("hero number", R(s, { type: "setAnswer", hero: 5, q: "q01", value: 1 }), "badInput");

/* ---- GM final say (lock) */
let g = must("gm sets", R(s, { type: "setAnswer", hero: A, q: "q01", value: 1 })); eq("gm cell locked", P.cellOf(g, "q01", A), { v: 1, g: 1 });
fail("player cannot change locked", R(g, { type: "setAnswer", hero: A, q: "q01", value: 0 }, P1), "locked");
g = must("unlock", R(g, { type: "unlock", hero: A, q: "q01" })); eq("unlocked", P.cellOf(g, "q01", A), { v: 1 });
g = must("player can after unlock", R(g, { type: "setAnswer", hero: A, q: "q01", value: 0 }, P1)); eq("player cell has no g", P.cellOf(g, "q01", A), { v: 0 });
fail("player unlock", R(g, { type: "unlock", hero: A, q: "q01" }, P1), "noPermission");
eq("unlock unlocked unchanged", R(g, { type: "unlock", hero: A, q: "q01" }).changed, false);
fail("unlock missing cell", R(g, { type: "unlock", hero: B, q: "q01" }), "unknownHero");
eq("same answer unchanged", R(g, { type: "setAnswer", hero: A, q: "q01", value: 0 }, P1).changed, false);

/* ---- flaw question + karma */
let f = must("to flaw", R(s, { type: "setQuestion", index: 4 }));
f = must("flaw yes", R(f, { type: "setAnswer", hero: A, q: "q05", value: 1 }, P1));
f = must("flaw x2", R(f, { type: "setAnswer", hero: B, q: "q05", value: 2 }, P2));
eq("flaw1 gain", P.gainOf(f, A), 1); eq("flaw2 gain", P.gainOf(f, B), 2); eq("no answer gain", P.gainOf(f, C), 0);
eq("summary overcame", P.summary(f).overcame, [B]); eq("summary flawBonus", P.summary(f).rows[1].flawBonus, 1);
// full session for a worked example
let w = must("w-start", R(null, { type: "start", id: "w", heroes: [{ id: A, name: "A" }, { id: B, name: "B" }], askBad: true }));
const say = (h, q, v) => { w = must(`w ${h}${q}`, R(w, { type: "setAnswer", hero: h, q, value: v })); };
for (const q of ["q01", "q02", "q03", "q04", "q06", "q07", "q08", "q09", "q10"]) say(A, q, 1);   // A: 9 yes
say(A, "q05", 2);                                                                              // + flaw overcome = 2
for (const q of ["q01", "q05"]) say(B, q, 1);                                                   // B: 2
say(B, "b05", 1); say(B, "b06", 1); say(B, "b04", 1); say(A, "b01", 1);
eq("worked A gain 11", P.gainOf(w, A), 11); eq("worked A loss 1", P.lossOf(w, A), 1); eq("worked B gain 2", P.gainOf(w, B), 2); eq("worked B loss 3", P.lossOf(w, B), 3);
eq("worked totals", [P.summary(w).gain, P.summary(w).loss, P.summary(w).net], [13, 4, 9]);
eq("applyKarma floor 0", P.applyKarma(0, 2, 3), 0); eq("applyKarma normal", P.applyKarma(5, 11, 1), 15); eq("applyKarma partial floor", P.applyKarma(1, 0, 3), 0);
eq("applyKarma garbage", P.applyKarma("x", NaN, -4), 0); eq("applyKarma huge", P.applyKarma(1e12, 1, 0), P.LIMITS.karmaMax); eq("applyKarma neg before", P.applyKarma(-5, 2, 0), 2);
eq("loss off when askBad false", P.lossOf({ ...w, askBad: false }, B), 0);
eq("setAskBad off", must("ab-off", R(w, { type: "setAskBad", value: false })).askBad, false);
ck("bad answers kept but ignored when askBad off", P.lossOf(must("ab-off2", R(w, { type: "setAskBad", value: false })), B) === 0);
eq("setAskBad off clamps index", must("clamp", R(must("g", R(w, { type: "setQuestion", index: 16 })), { type: "setAskBad", value: false })).index, 10);
fail("setAskBad player", R(w, { type: "setAskBad", value: false }, P1), "noPermission");
eq("setAskBad same unchanged", R(w, { type: "setAskBad", value: true }).changed, false);

/* ---- naive implementation cross-check (property) */
const naive = (answers, hero, askBad) => {
  let plus = 0, minus = 0;
  for (let i = 1; i <= 10; i++) { const id = "q" + String(i).padStart(2, "0"); const v = answers[id]?.[hero]?.v ?? 0; if (v > 0) plus += (id === "q05" && v === 2) ? 2 : 1; }
  if (askBad) for (let i = 1; i <= 6; i++) { const v = answers["b0" + i]?.[hero]?.v ?? 0; if (v > 0) minus += 1; }
  return [plus, minus];
};
const rnd = seeded(42);
const mkRandom = (askBad) => {
  let st = P.newSession({ id: "r" + Math.floor(rnd() * 1e6), heroes: [{ id: A, name: "A" }, { id: B, name: "B" }, { id: C, name: "C" }], now: 5, by: "gm1", askBad });
  for (let i = 0; i < 60; i++) {
    const q = P.questions(askBad)[Math.floor(rnd() * (askBad ? 16 : 10))], h = [A, B, C][Math.floor(rnd() * 3)];
    const v = q.flaw ? Math.floor(rnd() * 3) : Math.floor(rnd() * 2);
    const r = R(st, { type: "setAnswer", hero: h, q: q.id, value: v }); if (r.ok) st = r.session;
  }
  return st;
};
for (let i = 0; i < 40; i++) {
  const ab = i % 2 === 0, st = mkRandom(ab);
  for (const h of [A, B, C]) { const [p, m] = naive(st.answers, h, ab); ck(`naive gain ${i}${h}`, P.gainOf(st, h) === p); ck(`naive loss ${i}${h}`, P.lossOf(st, h) === m); }
  const sm = P.summary(st);
  ck(`summary net ${i}`, sm.net === sm.gain - sm.loss && sm.rows.reduce((a, r) => a + r.net, 0) === sm.net);
  ck(`gain bounded ${i}`, sm.rows.every((r) => r.gain <= 11 && r.gain >= 0 && r.loss <= 6));
  const plan = P.awardPlan(st, { [A]: 3, [B]: 0, [C]: 100 });
  ck(`plan after >= 0 ${i}`, plan.every((r) => r.after >= 0 && r.after === Math.max(0, r.before + r.gain - r.loss) && r.delta === r.after - r.before));
  const pr = P.progress(st);
  ck(`progress consistent ${i}`, pr.answered === Object.values(pr.per).reduce((a, p) => a + p.answered, 0) && pr.cells === P.total(st) * 3);
}

/* ---- heroes added / removed */
let h1 = must("add", R(s, { type: "addHero", hero: { id: D, name: "Delta", img: "icons/x.webp" } })); eq("add hero", h1.heroes.length, 4);
eq("add again unchanged", R(h1, { type: "addHero", hero: { id: D, name: "Delta" } }).changed, false);
fail("add by player", R(s, { type: "addHero", hero: { id: D, name: "D" } }, P1), "noPermission");
fail("add junk", R(s, { type: "addHero", hero: { id: "a b" } }), "badInput");
fail("add 25th", R(must("many", R(null, { type: "start", id: "m", heroes: Array.from({ length: 24 }, (_, i) => ({ id: "h" + i })) })), { type: "addHero", hero: { id: D } }), "tooMany");
eq("add js img stripped", must("img", R(s, { type: "addHero", hero: { id: D, name: "D", img: "javascript:alert(1)" } })).heroes[3].img, "");
eq("add data img stripped", must("img2", R(s, { type: "addHero", hero: { id: D, name: "D", img: " data:text/html,x" } })).heroes[3].img, "");
eq("add name sanitised", must("nm", R(s, { type: "addHero", hero: { id: D, name: "<b>X</b>\u0000".repeat(50) } })).heroes[3].name.length <= 80, true);
let r1 = must("ans C", R(s, { type: "setAnswer", hero: C, q: "q01", value: 1 })); r1 = must("rem", R(r1, { type: "removeHero", hero: C }));
eq("remove hero", r1.heroes.map((h) => h.id), [A, B]); eq("remove drops answers", P.cellOf(r1, "q01", C), null); eq("remove drops empty question row", Object.keys(r1.answers), []);
fail("remove unknown", R(s, { type: "removeHero", hero: D }), "unknownHero");
fail("remove by player", R(s, { type: "removeHero", hero: A }, P1), "noPermission");
const r2 = must("rem B", R(r1, { type: "removeHero", hero: B }));
fail("remove last hero", R(r2, { type: "removeHero", hero: A }), "noHeroes");
ck("answers of removed hero not countable", P.gainOf(r1, C) === 0);
ck("addHero works while closed", R(must("cl2", R(s, { type: "close" })), { type: "addHero", hero: { id: D, name: "D" } }).ok);

/* ---- close / reopen / discard */
let c = must("close", R(s, { type: "close" })); eq("closed state", c.state, "closed"); eq("close jumps to summary", c.index, 10); eq("closed view", P.view(c), "summary");
fail("close twice", R(c, { type: "close" }), "badState");
fail("close by player", R(s, { type: "close" }, P1), "noPermission");
fail("answer after close (player)", R(c, { type: "setAnswer", hero: A, q: "q01", value: 1 }, P1), "badState");
fail("answer after close (gm)", R(c, { type: "setAnswer", hero: A, q: "q01", value: 1 }), "badState");
fail("navigate after close", R(c, { type: "next" }), "badState");
eq("reopen", must("reopen", R(c, { type: "reopen" })).state, "open");
fail("reopen open", R(s, { type: "reopen" }), "badState");
fail("reopen by player", R(c, { type: "reopen" }, P1), "noPermission");
eq("discard open", must("disc", R(s, { type: "discard" })).state, "discarded");
eq("discard closed", must("disc2", R(c, { type: "discard" })).state, "discarded");
fail("discard by player", R(s, { type: "discard" }, P1), "noPermission");
fail("anything after discard", R({ ...s, state: "discarded" }, { type: "next" }), "badState");

/* ---- award: begin / rows / end, idempotence */
let aw = w;                                    // worked example (A 11/-1, B 2/-3)
fail("award while open", R(aw, { type: "awardBegin" }), "badState");
aw = must("w close", R(aw, { type: "close" }));
fail("award by player", R(aw, { type: "awardBegin" }, P1), "noPermission");
aw = must("awardBegin", R(aw, { type: "awardBegin" }));
eq("award applying", aw.award.state, "applying"); eq("award n", aw.award.n, 1); eq("rows pending", aw.award.rows.map((r) => r.st), [0, 0]);
eq("award rows gain/loss", aw.award.rows.map((r) => [r.gain, r.loss]), [[11, 1], [2, 3]]);
fail("awardBegin twice", R(aw, { type: "awardBegin" }), "badState");
fail("awardEnd incomplete", R(aw, { type: "awardEnd" }), "incomplete");
fail("awardRow unknown hero", R(aw, { type: "awardRow", hero: C, before: 1 }), "unknownHero");
fail("awardRow neg", R(aw, { type: "awardRow", hero: A, before: -1 }), "badInput");
fail("awardRow NaN", R(aw, { type: "awardRow", hero: A, before: NaN }), "badInput");
fail("awardRow by player", R(aw, { type: "awardRow", hero: A, before: 1 }, P1), "noPermission");
aw = must("row A", R(aw, { type: "awardRow", hero: A, before: 5 }));
eq("row A values", aw.award.rows[0], { h: A, gain: 11, loss: 1, before: 5, after: 15, st: 1 });
const again = R(aw, { type: "awardRow", hero: A, before: 99 }); eq("row A idempotent", again.changed, false); eq("row A keeps first value", again.session.award.rows[0].before, 5);
aw = must("row B", R(aw, { type: "awardRow", hero: B, before: 1 }));
eq("row B floors at 0", aw.award.rows[1].after, 0);
aw = must("awardEnd", R(aw, { type: "awardEnd" })); eq("awarded", aw.state, "awarded"); eq("award done", aw.award.state, "done");
fail("awardBegin after awarded", R(aw, { type: "awardBegin" }), "badState");
fail("reopen awarded", R(aw, { type: "reopen" }), "badState");
fail("close awarded", R(aw, { type: "close" }), "badState");
fail("discard awarded", R(aw, { type: "discard" }), "badState");
fail("answer awarded", R(aw, { type: "setAnswer", hero: A, q: "q01", value: 0 }), "badState");
fail("addHero awarded", R(aw, { type: "addHero", hero: { id: D, name: "D" } }), "badState");
fail("removeHero awarded", R(aw, { type: "removeHero", hero: A }), "badState");
eq("awardEnd again", R(aw, { type: "awardEnd" }).ok, false);
eq("awardKey", P.awardKey(aw), "w_1"); eq("awardKey none", P.awardKey(s), null);
// crash in the middle: only A applied, resume must not re-apply A
let mid = must("mid", R(must("mid0", R(must("mid1", R(w, { type: "close" })), { type: "awardBegin" })), { type: "awardRow", hero: A, before: 7 }));
ck("resume: pending row listed", mid.award.rows.filter((r) => r.st === 0).map((r) => r.h).join() === B);
mid = must("mid row B", R(mid, { type: "awardRow", hero: B, before: 4 })); eq("resume B after", mid.award.rows[1].after, 3);
eq("partial awardEnd allowed with flag", R(must("p0", R(must("p1", R(w, { type: "close" })), { type: "awardBegin" })), { type: "awardEnd", partial: true }).ok, true);
// request-id dedupe (two GM tabs handle the same relayed request)
const d1 = must("rid1", R(s, { type: "next", rid: "req-1" })); const d2 = R(d1, { type: "next", rid: "req-1" });
eq("rid dedupe ok", d2.ok, true); eq("rid dedupe dup", d2.dup, true); eq("rid dedupe index", d2.session.index, 1); eq("rid dedupe unchanged", d2.changed, false);
let ring = s; for (let i = 0; i < 60; i++) ring = must("ring", R(ring, { type: i % 2 ? "prev" : "next", rid: "r" + i }));
ck("seen ring capped", ring.seen.length === P.LIMITS.seen); ck("log capped", ring.log.length <= P.LIMITS.log);

/* ---- undo with drift guard */
const now2 = { [A]: 15, [B]: 0 };
let up = P.undoPlan(aw, now2); eq("undo plan ok", up.map((r) => [r.h, r.status, r.restoreTo]), [[A, "ok", 5], [B, "ok", 1]]);
up = P.undoPlan(aw, { [A]: 20, [B]: 0 }); eq("drift strict", up[0].status, "drift"); eq("drift strict no restore", up[0].restoreTo, null);
up = P.undoPlan(aw, { [A]: 20, [B]: 0 }, "relative"); eq("drift relative", [up[0].status, up[0].restoreTo, up[0].drifted], ["ok", 10, true]);
up = P.undoPlan(aw, { [A]: 3, [B]: 0 }, "relative"); eq("relative clamps at 0", up[0].restoreTo, 0 );
eq("drift missing karma", P.undoPlan(aw, {})[0].status, "drift"); eq("drift NaN karma", P.undoPlan(aw, { [A]: "x" })[0].status, "drift");
eq("undoPlan without award", P.undoPlan(s), []);
fail("undoRow before award", R(s, { type: "undoRow", hero: A }), "badState");
fail("undoRow by player", R(aw, { type: "undoRow", hero: A }, P1), "noPermission");
fail("undoRow unknown", R(aw, { type: "undoRow", hero: C }), "unknownHero");
let u = must("undo A", R(aw, { type: "undoRow", hero: A })); eq("undo state", u.award.state, "undoing"); eq("undo row st", u.award.rows[0].st, 2);
eq("undo A idempotent", R(u, { type: "undoRow", hero: A }).changed, false);
const part = R(u, { type: "undoEnd" }); eq("undoEnd partial while B applied", part.partial, true); eq("still awarded", part.session.state, "awarded");
u = must("undo B", R(u, { type: "undoRow", hero: B }));
u = must("undoEnd", R(u, { type: "undoEnd" })); eq("undone -> closed", u.state, "closed"); eq("award cleared", u.award, null); eq("award history", u.awards.length, 1); eq("history rows", u.awards[0].rows.map((r) => r.st), [2, 2]);
eq("re-award n increments", must("re", R(u, { type: "awardBegin" })).award.n, 2);
eq("re-award key differs", P.awardKey(must("re2", R(u, { type: "awardBegin" }))), "w_2");
fail("undoEnd after cleared", R(u, { type: "undoEnd" }), "badState");
const reopened = must("reopen after undo", R(u, { type: "reopen" })); eq("can edit again", must("edit", R(reopened, { type: "setAnswer", hero: A, q: "q01", value: 0 })).state, "open");
// undo of a row that was never applied (partial award)
const pa = must("pa", R(must("pa1", R(must("pa0", R(w, { type: "close" })), { type: "awardBegin" })), { type: "awardRow", hero: A, before: 2 }));
const pe = must("pe", R(pa, { type: "awardEnd", partial: true }));
eq("undo plan notApplied row", P.undoPlan(pe, { [A]: 12, [B]: 0 }).map((r) => r.status), ["ok", "notApplied"]);
fail("undoRow notApplied", R(pe, { type: "undoRow", hero: B }), "badState");

/* ---- undo restores exact karma (property over random sessions, drift guard) */
for (let i = 0; i < 40; i++) {
  let st = mkRandom(i % 2 === 0); st = must("c", R(st, { type: "close" })); st = must("b", R(st, { type: "awardBegin" }));
  const kar = { [A]: Math.floor(rnd() * 30), [B]: Math.floor(rnd() * 3), [C]: Math.floor(rnd() * 100) };
  const live = { ...kar };
  for (const h of [A, B, C]) { st = must("row", R(st, { type: "awardRow", hero: h, before: live[h] })); live[h] = st.award.rows.find((r) => r.h === h).after; }
  st = must("end", R(st, { type: "awardEnd" }));
  const plan = P.undoPlan(st, live);
  ck(`undo plan all ok ${i}`, plan.every((p) => p.status === "ok"));
  for (const p of plan) { live[p.h] = p.restoreTo; st = must("ur", R(st, { type: "undoRow", hero: p.h })); }
  st = must("ue", R(st, { type: "undoEnd" }));
  ck(`karma restored exactly ${i}`, canon(live) === canon(kar)); ck(`state closed after undo ${i}`, st.state === "closed");
  // double award idempotence: replaying every awardRow/awardBegin on a finished award changes nothing
}
for (let i = 0; i < 20; i++) {
  let st = must("c", R(mkRandom(true), { type: "close" })); st = must("b", R(st, { type: "awardBegin" }));
  for (const h of [A, B, C]) st = must("row", R(st, { type: "awardRow", hero: h, before: 10 }));
  st = must("end", R(st, { type: "awardEnd" }));
  const replay = [{ type: "awardBegin" }, { type: "awardRow", hero: A, before: 50 }, { type: "awardEnd" }, { type: "close" }, { type: "reopen" }].map((a) => R(st, a));
  ck(`replays refused or no-op ${i}`, replay.every((r) => !r.ok || r.changed === false));
  ck(`state unchanged by replays ${i}`, replay.every((r) => !r.ok || canon(r.session) === canon(st)));
}

/* ---- immutability + reducers never produce invalid states (random action fuzz) */
const ACT = ["setQuestion", "next", "prev", "setAnswer", "unlock", "addHero", "removeHero", "setAskBad", "close", "reopen", "awardBegin", "awardRow", "awardEnd", "undoRow", "undoEnd", "discard", "start", "bogus"];
const junk = [null, undefined, 0, -1, 99, "", "x", "__proto__", NaN, {}, [], true, A, B, C, D, "q05", "b03", "q01", 1, 2, 10, 16];
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const validShape = (st) => {
  if (!st || st.v !== 1 || !P.STATES.includes(st.state)) return false;
  if (!st.heroes.length || st.heroes.length > P.LIMITS.heroes) return false;
  const ids = new Set(st.heroes.map((h) => h.id)); if (ids.size !== st.heroes.length) return false;
  if (!Number.isInteger(st.index) || st.index < 0 || st.index > P.total(st)) return false;
  for (const q of Object.keys(st.answers)) { if (!P.ALL_IDS.includes(q)) return false; for (const h of Object.keys(st.answers[q])) { if (!ids.has(h)) return false; const cell = st.answers[q][h]; if (![0, 1, 2].includes(cell.v) || (cell.v === 2 && q !== P.FLAW_ID)) return false; } }
  if (st.log.length > P.LIMITS.log || st.seen.length > P.LIMITS.seen || st.awards.length > P.LIMITS.awardHistory) return false;
  if (st.state === "awarded" && !st.award) return false;
  if (st.award) for (const r of st.award.rows) { if (!ids.has(r.h) || r.after < 0 || (r.st && r.after !== P.applyKarma(r.before, r.gain, r.loss))) return false; }
  if (typeof st.rev !== "number" || st.rev < 1) return false;
  return true;
};
let runs = 0, okRuns = 0;
for (let i = 0; i < 60; i++) {
  let st = null;
  for (let step = 0; step < 120; step++) {
    const user = pick([GM, GM, P1, P2, P3]);
    const act = { type: pick(ACT), hero: pick(junk), q: pick(junk), value: pick(junk), index: pick(junk), before: pick(junk), partial: pick([true, false, undefined]), heroes, hero2: 1, rid: rnd() < 0.2 ? pick(["a", "b"]) : undefined, id: "fz" + i };
    if (rnd() < 0.5) { const sm = pick(["next", "prev", "setAnswer", "setAnswer", "setAnswer", "close", "reopen", "awardBegin", "awardRow", "awardEnd", "undoRow", "undoEnd", "setAskBad", "unlock", "removeHero"]); act.type = st ? sm : "start"; act.hero = pick([A, B, C]); act.q = pick(P.ALL_IDS); act.value = pick([0, 1, 1, 2]); act.before = Math.floor(rnd() * 20); act.value = act.type === "setAskBad" ? rnd() < 0.5 : act.value; if (st && rnd() < 0.5 && act.type === "setAnswer") act.q = P.currentQuestion(st)?.id ?? act.q; }
    if (act.type === "addHero") act.hero = pick([{ id: pick([A, B, C, D, "ee"]), name: "N" }, junk[0], pick(junk)]);
    if (st) deepFreeze(st);
    const before = st ? canon(st) : null;
    const r = P.reduce(st, act, ctxFor(user, step));
    runs++;
    ck(`fuzz result shape ${i}.${step}`, typeof r.ok === "boolean" && (r.ok || (r.error && typeof r.error.key === "string" && r.error.key.startsWith("IPL.Session.err."))));
    if (st && before !== canon(st)) fails.push(`MUTATED input ${i}.${step}`);
    if (r.error?.code === "internal") fails.push(`internal error ${i}.${step} ${r.error.params.msg}`);
    if (r.ok && r.changed) { okRuns++; st = r.session; if (st.state === "discarded") { st = null; continue; } if (!validShape(st)) fails.push(`INVALID state ${i}.${step} ${act.type} ${canon(st).slice(0, 200)}`); }
    else ck(`failed action leaves state ${i}.${step}`, !r.session || r.session === st || (!r.changed && r.ok));
    if (st && r.ok && !r.changed) ck(`no-op keeps same object ${i}.${step}`, r.session === st || canon(r.session) === canon(st));
    if (!r.ok && st && user.staff !== true && P.STAFF_ONLY.has(act.type)) ck(`player staff action refused ${i}.${step}`, r.error.code === "noPermission");
  }
}
ck("fuzz ran many steps", runs >= 7000); ck("fuzz had real transitions", okRuns > 500);

/* ---- sanitize / serialisation / hostile input */
const base = must("san base", R(s, { type: "setAnswer", hero: A, q: "q01", value: 1 }));
eq("roundtrip", P.sanitize(JSON.parse(JSON.stringify(base))), base); eq("parse(serialize)", P.parse(P.serialize(base)), base);
eq("sanitize idempotent", P.sanitize(P.sanitize(w)), P.sanitize(w)); eq("worked example roundtrips", P.parse(P.serialize(aw)), P.sanitize(aw));
for (const bad of [null, undefined, 0, "", "x", "{", "[]", [], {}, { v: 1 }, { v: 2, id: "x", state: "open", heroes: [{ id: A }] }, { ...base, id: "__proto__" }, { ...base, state: "weird" }, { ...base, heroes: [] }, { ...base, heroes: "x" }])
  ck(`sanitize rejects ${canon(bad)?.slice(0, 40)}`, P.sanitize(bad) === null);
ck("sanitize oversize string", P.sanitize("x".repeat(P.LIMITS.bytes + 1)) === null);
const hostile = JSON.parse(`{"v":1,"id":"h1","state":"open","heroes":[{"id":"AAAA","name":"<img onerror=x>","img":"javascript:1"},{"id":"__proto__","name":"p"},{"id":"constructor"}],
 "answers":{"q01":{"AAAA":{"v":9},"__proto__":{"v":1},"constructor":{"v":1},"ZZ":{"v":1}},"__proto__":{"AAAA":{"v":1}},"q02":{"AAAA":{"v":2,"g":"yes"}},"q05":{"AAAA":{"v":2}},"zz":{"AAAA":{"v":1}}},
 "index":999,"askBad":"true","rev":-4,"log":[null,5,{"a":"x","q":"<script>","u":"__proto__"}],"seen":[1,"ok",{"a":1}],"award":{"n":-5,"state":"x","rows":[{"h":"AAAA","st":1,"before":-9,"after":1e99},{"h":"nobody"}]},"toString":"x","polluted":1}`);
const hs = P.sanitize(hostile);
ck("hostile sanitised not null", hs !== null); eq("hostile hero filter", hs.heroes.map((h) => h.id), ["AAAA"]); eq("hostile name no tags", hs.heroes[0].name.includes("<"), false); eq("hostile img", hs.heroes[0].img, "");
eq("hostile v clamp", P.cellOf(hs, "q01", "AAAA"), { v: 1 }); eq("hostile v2 off flaw", P.cellOf(hs, "q02", "AAAA"), { v: 1, g: 1 }); eq("hostile flaw v2 kept", P.cellOf(hs, "q05", "AAAA"), { v: 2 });
eq("hostile answers keys", Object.keys(hs.answers).sort(), ["q01", "q02", "q05"]); eq("hostile unknown cell dropped", Object.keys(hs.answers.q01), ["AAAA"]);
eq("hostile askBad strict boolean", hs.askBad, false); eq("hostile index clamp", hs.index, 10); eq("hostile rev", hs.rev, 1);
eq("hostile log", hs.log.length, 1); eq("hostile log q dropped", hs.log[0].q, undefined); eq("hostile log u dropped", hs.log[0].u, "");
eq("hostile seen", hs.seen, ["ok"]); eq("hostile award n", hs.award.n, 1); eq("hostile award rows", hs.award.rows.length, 1); eq("hostile award values", [hs.award.rows[0].before, hs.award.rows[0].after], [0, P.LIMITS.karmaMax]);
ck("hostile extra keys dropped", !("polluted" in hs) && !Object.keys(hs).includes("toString"));
ck("no pollution of Object.prototype", ({}).polluted === undefined && ({}).v === undefined && ({}).AAAA === undefined);
ck("hostile answers has no own __proto__ key", !Object.prototype.hasOwnProperty.call(hs.answers, "__proto__"));
const big = { ...base, heroes: Array.from({ length: 500 }, (_, i) => ({ id: "h" + i, name: "n".repeat(500) })), log: Array.from({ length: 1000 }, () => ({ a: "x".repeat(500) })), seen: Array.from({ length: 1000 }, () => "z".repeat(500)) };
const bs = P.sanitize(big); ck("big capped heroes", bs.heroes.length === P.LIMITS.heroes); ck("big capped log", bs.log.length === P.LIMITS.log); ck("big capped seen", bs.seen.length === P.LIMITS.seen);
ck("big capped name", bs.heroes.every((h) => h.name.length <= P.LIMITS.name)); ck("serialized size sane", P.serialize(bs).length < 40000);
ck("serialized full session < 40KB", P.serialize(mkRandom(true)).length < 40000);
eq("serialize garbage", P.serialize({}), "null");
eq("award state mismatch repaired", P.sanitize({ ...aw, state: "closed" }).state, "awarded"); eq("awarded without award -> closed", P.sanitize({ ...base, state: "awarded", award: null }).state, "closed");
eq("applying award keeps closed", P.sanitize({ ...mid, state: "closed" }).state, "closed");
eq("index clamped when askBad false", P.sanitize({ ...sb, askBad: false, index: 16 }).index, 10);
eq("future schema rejected", P.sanitize({ ...base, v: 2 }), null);
eq("ownedBy", P.ownedBy(s, ctxFor(P1)), [A, C]); eq("ownedBy none", P.ownedBy(s, ctxFor(P3)), []);

/* ---- progress / summary derivations */
const pg = P.progress(P.sanitize(base)); eq("progress cells", pg.cells, 30); eq("progress answered", pg.answered, 1); eq("progress current pending", pg.current.pending, [B, C]); eq("progress current yes", pg.current.yes, 1);
eq("progress atSummary", pg.atSummary, false); eq("progress summary", P.progress(c).atSummary, true); eq("progress none", P.progress(null).total, 10);
eq("summary empty", P.summary(s).gain, 0); eq("summary null safe", P.summary(null).rows, []);
eq("summary yes ids", P.summary(w).rows[0].yes.length, 10 + 1); eq("cellValue unknown", P.cellValue(s, "zz", "yy"), 0); eq("cellValue proto", P.cellValue(s, "__proto__", "x"), 0);
eq("isId", [P.isId("abc"), P.isId("__proto__"), P.isId(""), P.isId("a".repeat(41)), P.isId(5), P.isId("a b")], [true, false, false, false, false, false]);
eq("clampText", P.clampText("  a\u0000\n<b>  c ", 10), "a b c");

if (fails.length) { console.error(`FAIL ${fails.length}/${n}:\n` + fails.slice(0, 40).join("\n")); process.exit(1); }
console.log(`OK ${n} checks`);
