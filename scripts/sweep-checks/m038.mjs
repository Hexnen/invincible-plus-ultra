// node scripts/sweep-checks/m038.mjs  (S038: real biography drafts - len + to, no from - merge into one entry per 30 s window, spec 2.3)
import * as D from "../log/diff.mjs";
import * as C from "../log/coalesce.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
// the draft the scribe really makes (diff.draftsFromDiff), not a hand-built one with `from`
const hero = (bio) => ({ name: "H", system: { biography: bio } });
const draft = (a, b) => D.draftsFromDiff(D.diffObjects(hero(a), hero(b)), { scope: "hero", before: D.flatten(hero(a)), after: D.flatten(hero(b)) }).find((x) => x.k === "stat.text");
const d1 = draft("<p>Hi</p>", "<p>Hi there</p>"), d2 = draft("<p>Hi there</p>", "<p>Hi there you</p>"), d3 = draft("<p>Hi there you</p>", "<p>Hi there you all</p>");
ck("draft is the real shape (no from)", d1 && !("from" in d1.d) && Array.isArray(d1.d.len));
const ev = (d, t) => ({ actorId: "A1", k: "stat.text", path: "system.biography", u: "u1", t, d: d.d });
ck("biography draft is mergeable", C.isMergeable(ev(d1, 0)));
const r = C.coalesceEvents([ev(d1, 0), ev(d2, 10000), ev(d3, 25000)]);
ck("three saves in 30 s windows -> one entry", r.entries.length === 1 && r.entries[0].n === 3);
const m = r.entries[0]?.d ?? {};
ck("merged len spans first old to last new", m.len?.[0] === 2 && m.len?.[1] === "Hi there you all".length);
ck("merged to is the last text", m.to === "Hi there you all" && !("from" in m));
ck("past 30 s quiet -> a new entry", C.coalesceEvents([ev(d1, 0), ev(d2, 40000)]).entries.length === 2);
// the live Coalescer path too
const co = new C.Coalescer();
co.add(ev(d1, 0)); co.add(ev(d2, 5000));
const out = co.drain(1e9, { force: true });
ck("Coalescer merges real bio drafts", Array.isArray(out) && out.filter((e) => e.k === "stat.text").length === 1);
// other text keys unchanged
const o = { actorId: "A1", k: "stat.text", path: "system.occupation", u: "u1", d: { key: "occupation", from: "a", to: "b" } };
ck("text with from still merges and cancels", C.coalesceEvents([{ ...o, t: 0 }, { ...o, t: 500, d: { key: "occupation", from: "b", to: "a" } }]).cancelled === 1);
console.log(`sweep m038: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
