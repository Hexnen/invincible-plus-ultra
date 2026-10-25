/* Activity log UI: per-type row rendering (spec 6.1). From an entry (type id + raw data) it builds the sentence (via IPL.Sum.<type>[.<variant>]), the
   icon, the badges and the detail panel (diff table, dice, children, links). Prose is built at display time, so the language switch reaches old entries.
   Import-safe in Node (check-lang runs sentenceText on samples); DOM is only touched inside functions. `ctx` comes from view.mjs:
   { scope, userName(id), actor() -> Actor|null, isGM, lookupMessage(id) -> bool, notesOn: Map(entryId -> [entry]) } */
import * as E from "../events.mjs";
import { t, tn, has, ATTRS, VITALS, TRACKS } from "../lang.mjs";
import { h, icon, sr, uid, buildNodes, buildText } from "./dom.mjs";

/* ------------------------------------------------------------------ values */
export const clip = (s, n = 60) => { const x = String(s); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
const fmtText = (v) => (typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? fmtVal(v, 1000) : String(v));
/** A value as shown in a sentence or table cell. */
export function fmtVal(v, lim = 80) {
  if (v === null || v === undefined || v === "") return t("IPL.Sum.Empty");
  if (typeof v === "boolean") return v ? "✓" : "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "object") { try { return clip(JSON.stringify(v), lim); } catch { return "—"; } }     // L8: a hostile object value must not print "[object Object]"
  return clip(String(v), lim);
}
const lastSeg = (p) => String(p).split(".").pop();
/** L8: entries come from files and other modules; only plain objects are used where the renderers read fields. */
const objs = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : []);
export function keyLabel(key) {
  if (key == null) return "";
  const k = `IPL.Key.${key}`;
  return has(k) ? t(k) : String(key);
}
export function itemTypeLabel(type) { const k = `IPL.ItemType.${type}`; return has(k) ? t(k) : String(type ?? ""); }
export function pathLabel(p) { const k = `IPL.Path.${lastSeg(p)}`; return has(k) ? t(k) : String(p); }
export function levelLabel(v) { const k = `IPL.Level.${v}`; return has(k) ? t(k) : fmtVal(v); }
export function statusLabel(v) { const k = `IPL.Status.${v}`; return has(k) ? t(k) : fmtVal(v); }
export function actionLabel(s) {
  const k = `IPL.Action.${s}`;
  if (has(k)) return t(k);
  const m = String(s).match(/^action(\d+)$/i);
  return m ? t("IPL.Action.n", { n: m[1] }) : String(s);
}
export const isItemType = (k) => k === "item.add" || k === "item.remove" || k === "item.edit" || k === "item.toggle";

/** Sentence variant suffix for types with several wordings (the strings are listed in lang.mjs VARIANTS). */
export function variantOf(e) {
  const d = e.d || {};
  switch (e.k) {
    case "stat.vital": return typeof d.from === "number" && typeof d.to === "number" ? (d.to > d.from ? "up" : d.to < d.from ? "down" : "") : "";
    case "stat.text": return d.key === "biography" ? "bio" : "";
    case "actor.img": return d.what === "token" ? "token" : "portrait";
    case "item.toggle": return d.on ? "on" : "off";
    case "damage.taken": return d.attacker && d.attacker.name ? "att" : "";
    case "combat.action": return d.on ? "on" : "off";
    case "actor.created": return d.dupOf ? "dup" : "";
    case "card.occupied": return d.on ? "on" : "off";
    case "event.reroll": case "event.resolved": case "event.applied": case "event.note": case "event.dismissed": case "event.undone": return d.name ? "named" : "";
    case "upgrade.add": return d.source === "starting" || d.source === "granted" || d.source === "bought" ? d.source : "";
    default: return "";
  }
}
export function sumKey(e) {
  const def = E.typeDef(e.k);
  if (!def) return "IPL.Sum.unknown";
  const v = variantOf(e), k = `IPL.Sum.${e.k}`;
  return v && has(`${k}.${v}`) ? `${k}.${v}` : k;
}

/* ------------------------------------------------------------------ parameters of a sentence */
function whoNode(e, ctx, dom, opts) {
  const name = e.u ? ctx.userName(e.u) : t("IPL.UI.System");
  if (!dom) return name;
  return h("b.ipl-who", h("bdi", name));
}
function linkNode(kind, id, label, ctx, dom, alive) {
  if (!dom) return label;
  if (alive) return h("button.ipl-link", { type: "button", "data-ipl-act": kind, "data-ipl-id": id }, label);
  return h("span.ipl-name.ipl-gone", { title: kind === "item" ? t("IPL.UI.ItemGone") : t("IPL.UI.ActorGone") }, label);
}
function itemName(e, ctx, dom) {
  const d = e.d || {};
  const live = e.k !== "item.remove" ? ctx.actor?.(e)?.items?.get?.(d.id) : null;
  const label = d.name || live?.name || "";   // history shows the name at that time; the link opens the item as it is now
  if (!dom) return label;
  if (e.k === "item.remove") return h("span.ipl-name", label);
  const n = linkNode("item", d.id, label, ctx, dom, !!live);
  if (live && d.name && live.name !== d.name) n.title = t("IPL.UI.NowCalled", { name: live.name });
  return n;
}
function actorName(id, name, ctx, dom) {
  const live = id ? globalThis.game?.actors?.get?.(id) : null;
  const label = live?.name || name || "";
  if (!dom) return label;
  return live ? linkNode("actor", id, label, ctx, dom, true) : h("span.ipl-name" + (id ? ".ipl-gone" : ""), label);
}
/** Parameters for t(sumKey, params). dom=true gives nodes for who and linked names, false gives plain strings. */
export function paramsOf(e, ctx, dom = false, opts = {}) {
  const d = e.d || {};
  const base = E.summarize(e).params;
  const p = { ...base, who: whoNode(e, ctx, dom, opts) };
  p.name = d.name != null ? String(d.name) : "";
  if (d.from !== undefined) p.from = fmtVal(d.from, 60);
  if (d.to !== undefined) p.to = fmtVal(d.to, 60);
  if (d.key !== undefined) p.key = keyLabel(d.key);
  if (d.type !== undefined) p.type = itemTypeLabel(d.type);
  p.abs = p.abs ?? 0;
  switch (e.k) {
    case "item.add": case "item.remove": case "item.edit": case "item.toggle":
      p.name = itemName(e, ctx, dom);
      p.lvl = d.level != null && d.level !== "" ? ` (${t("IPL.Sum.Level", { n: d.level })})` : "";
      if (e.k === "item.edit") p.what = objs(d.changes).map((c) => pathLabel(c.p)).join(", ") || "—";
      break;
    case "effect.add": case "effect.remove": case "effect.edit": p.name = d.name ? String(d.name) : ""; break;
    case "stat.text":
      if (d.key === "biography" && Array.isArray(d.len)) p.len = t("IPL.Sum.Characters", { n: d.len[1] });
      break;
    case "access.owner": p.name = d.name || ctx.userName(d.user); p.from = levelLabel(d.from); p.to = levelLabel(d.to); break;
    case "access.default": p.from = levelLabel(d.from); p.to = levelLabel(d.to); break;
    case "roll.made": {
      const parts = [];
      parts.push(d.s > 0 ? tn("IPL.Plural.Success", d.s) : t("IPL.Out.None"));
      if (d.b > 0) parts.push(tn("IPL.Plural.Bane", d.b));
      if (d.p > 0) parts.push(t("IPL.Out.Push", { n: d.p }));
      if (d.dmg) parts.push(t("IPL.Out.Dmg", { n: d.dmg }));
      p.result = parts.join(", ");
      p.name = d.name || "—";
      break;
    }
    case "damage.taken": p.amount = d.amount ?? 0; p.attacker = d.attacker && d.attacker.name ? d.attacker.name : ""; break;
    case "combat.action": p.status = actionLabel(d.status); break;
    case "combat.turn": p.round = d.round ?? "?"; break;
    case "combat.end": p.roundsTxt = tn("IPL.Plural.Rounds", d.rounds ?? 0); break;
    case "chargen.apply": {
      const add = (Array.isArray(d.add) ? d.add.length : 0) + (d.more?.add || 0), del = (Array.isArray(d.del) ? d.del.length : 0) + (d.more?.del || 0);
      const s = t("IPL.Sum.Build", { add, del, fields: Array.isArray(d.fields) ? d.fields.length : 0 });
      p.summary = d.rank != null && d.rank !== "" ? t("IPL.Sum.BuildRank", { rank: String(d.rank), summary: s }) : s;
      break;
    }
    case "team.join": case "team.leave": p.name = actorName(d.baseId, d.name, ctx, dom); break;
    case "member.add": case "member.remove": p.name = actorName(d.id, d.name, ctx, dom); break;
    case "actor.created": p.dupOf = d.dupOf ? (d.dupOf.name || globalThis.game?.actors?.get?.(d.dupOf.id)?.name || d.dupOf.id || "") : ""; break;
    case "bulk.change": p.changes = tn("IPL.Plural.Changes", d.n ?? (Array.isArray(d.kids) ? d.kids.length : 0)); break;
    case "log.gap": p.changes = tn("IPL.Plural.Changes", d.total ?? ((Array.isArray(d.changes) ? d.changes.length : 0) + (d.more || 0))); break;
    case "log.prune": p.removed = d.removed ?? 0; break;
    case "log.redact": case "log.import": p.n = d.n ?? 0; p.entries = tn("IPL.Plural.Entries", d.n ?? 0); break;
    case "note.add": case "note.gm": p.text = clip(d.text ?? "", 300); break;
    case "card.edit": p.key = keyLabel(d.field); break;
    case "card.roll": p.key = keyLabel(d.table); p.result = d.result != null ? `${fmtVal(d.result)}${d.roll != null ? ` (${d.roll})` : ""}` : fmtVal(d.roll); break;
    case "upgrade.status": p.from = statusLabel(d.from); p.to = statusLabel(d.to); break;
    case "upgrade.buy": p.cost = d.cost ?? 0; break;
    case "upgrade.add": p.paid = d.paid ?? 0; break;
    case "event.rolled": p.label = d.label ? String(d.label) : d.roll != null ? `D66 ${d.roll}` : ""; break;
    case "crate.qty": p.qty = d.qty ?? ""; break;
    case "crate.give": p.to = d.to && d.to.name ? d.to.name : ""; break;
    case "sync.push": p.members = Array.isArray(d.members) ? d.members.join(", ") : ""; break;
    case "sync.adopt": p.from = d.from && d.from.name ? d.from.name : ""; break;
    case "policy.change": p.key = String(d.key ?? ""); break;
    default: break;
  }
  p.type = p.type ?? "";
  return p;
}
/** The sentence as a DocumentFragment (who bold, names as links). opts.kid: a child line without the author. */
export function sentenceNodes(e, ctx, opts = {}) { return buildNodes(t(sumKey(e)), paramsOf(e, ctx, true, opts), opts); }
const textCache = new WeakMap();
/** The sentence as plain text (search, export, aria). Cached per entry and language. */
export function sentenceText(e, ctx, opts = {}) {
  if (!opts.kid) { const hit = textCache.get(e); if (hit && hit.lang === langKey()) return hit.text; }
  const text = buildText(t(sumKey(e)), paramsOf(e, ctx, false, opts), opts);
  if (!opts.kid) textCache.set(e, { lang: langKey(), text });
  return text;
}
const langKey = () => { try { return globalThis.game?.i18n?.lang ?? "en"; } catch { return "en"; } };
// t(key) without data keeps the {name} tokens intact (fill leaves unknown tokens), so the raw template is re-filled by buildText / buildNodes.

/* ------------------------------------------------------------------ icon, category */
export function iconClass(e) {
  const d = e.d || {};
  if (e.k === "item.add" || e.k === "item.remove" || e.k === "item.edit") return `fa-solid ${E.itemIcon(d.type)}`;
  if (e.k === "item.toggle") return `fa-solid ${d.on ? "fa-toggle-on" : "fa-toggle-off"}`;
  if (e.k === "stat.vital") return `fa-solid ${d.key === "resolve" ? "fa-brain" : d.key === "slugfest" ? "fa-hand-fist" : "fa-heart-pulse"}`;
  const raw = E.iconOf(e.k);
  return `fa-solid ${raw}`;
}
export const catOf = (e, ctx) => E.categoryOf(e.k, e.sc || ctx.scope);
export const catLabel = (cat) => t(`IPL.Cat.${cat}`);

/* ------------------------------------------------------------------ time */
const fmtCache = new Map();
function dtf(lang, opts) { const k = lang + JSON.stringify(opts); let f = fmtCache.get(k); if (!f) { f = new Intl.DateTimeFormat(lang, opts); fmtCache.set(k, f); } return f; }
export const langTag = () => { const l = langKey(); return l === "pl" ? "pl-PL" : l === "en" ? "en-GB" : l; };
export const fmtClock = (ms) => dtf(langTag(), { hour: "2-digit", minute: "2-digit" }).format(ms);
export const fmtFull = (ms) => dtf(langTag(), { dateStyle: "full", timeStyle: "medium" }).format(ms);
export const fmtDay = (ms) => dtf(langTag(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(ms);
export function fmtGap(ms) {
  const min = Math.round(ms / 60000);
  if (min < 90) return t("IPL.Sum.Unit.min", { n: Math.max(1, min) });
  const hrs = Math.round(ms / 3600000);
  if (hrs < 48) return t("IPL.Sum.Unit.h", { n: hrs });
  return t("IPL.Sum.Unit.d", { n: Math.round(ms / 86400000) });
}

/* ------------------------------------------------------------------ badges (right side of the row) */
const numeric = (d) => typeof d.from === "number" && typeof d.to === "number";
export function badgesOf(e, ctx) {
  const d = e.d || {};
  const out = [];
  if (numeric(d) && !t(sumKey(e)).includes("{from}")) {   // the sentence already says "from A to B" for most types; the chip serves the wordings that do not
    const dir = d.to > d.from ? "up" : d.to < d.from ? "down" : "same";
    out.push(h("span.ipl-chip.ipl-diff", { class: `ipl-${dir}` },
      h("span", { "aria-hidden": "true" }, `${d.from} → ${d.to}`),
      sr(t("IPL.UI.FromTo", { from: d.from, to: d.to }))));
  }
  if (d.cause && has(`IPL.Cause.${d.cause}`) && d.cause !== "manual") out.push(h("span.ipl-chip.ipl-cause", t(`IPL.Cause.${d.cause}`)));
  if (e.k === "item.add" && d.src && has(`IPL.Src.${d.src}`)) out.push(h("span.ipl-chip.ipl-cause", t(`IPL.Src.${d.src}`)));
  if (e.k === "roll.made" && d.mode && d.mode !== "public" && has(`IPL.Mode.${d.mode}`)) out.push(h("span.ipl-chip.ipl-cause", t(`IPL.Mode.${d.mode}`)));
  if (e.n > 1) out.push(h("span.ipl-chip.ipl-n", { title: t("IPL.UI.Merged", { n: e.n }) }, h("span", { "aria-hidden": "true" }, `×${e.n}`), sr(t("IPL.UI.Merged", { n: e.n }))));
  if (e.c && e.c.r != null) out.push(h("span.ipl-chip.ipl-round", { title: t("IPL.UI.RoundTip", { n: e.c.r }) }, h("span", { "aria-hidden": "true" }, t("IPL.UI.RoundBadge", { n: e.c.r })), sr(t("IPL.UI.RoundTip", { n: e.c.r }))));
  if (E.visibilityOf(e) === "G") out.push(h("span.ipl-chip.ipl-gm", { title: t("IPL.UI.GmOnlyTip") }, icon("fa-lock"), h("span", t("IPL.UI.GmOnly"))));
  if (e.a && e.rel) out.push(h("span.ipl-chip.ipl-approx.ipl-unv", { title: t("IPL.UI.UnverifiedTip") }, icon("fa-user-clock"), h("span", t("IPL.UI.Unverified"))));      // queued on a player's device while no GM was connected
  else if (e.a) out.push(h("span.ipl-chip.ipl-approx", { title: t("IPL.UI.ApproxTip") }, icon("fa-triangle-exclamation"), h("span", t("IPL.UI.Approx"))));
  if (e.ua) out.push(h("span.ipl-chip.ipl-approx.ipl-ua", { title: t("IPL.UI.ChatDerivedTip") }, icon("fa-comment-dots"), h("span", t("IPL.UI.ChatDerived"))));
  if (e.imp) out.push(h("span.ipl-chip.ipl-imp", { title: t("IPL.UI.ImportedTip") }, icon("fa-file-import"), h("span", t("IPL.UI.Imported"))));
  if (ctx.showActor && e.aid) {                                                         // merged Table log: whose log is this row from
    const live = globalThis.game?.actors?.get?.(e.aid), name = live?.name || ctx.actorName?.(e.aid) || "";
    out.unshift(live ? h("button.ipl-chip.ipl-actor", { type: "button", "data-ipl-act": "actor", "data-ipl-id": e.aid, title: t("IPL.Table.OpenActor", { name }), "aria-label": t("IPL.Table.OpenActor", { name }) }, h("span", name))
      : h("span.ipl-chip.ipl-actor.ipl-gone", { title: t("IPL.Table.Orphan") }, h("span", name), h("span.ipl-sr", ` (${t("IPL.Table.Orphan")})`)));
  }
  return out;
}

/* ------------------------------------------------------------------ detail panel */
function cellValue(v) {
  if (v == null || v === "") return h("span.ipl-none", t("IPL.Sum.Empty"));
  return h("span.ipl-val", fmtVal(v, 1000));
}
function deltaCell(from, to) {
  if (typeof from === "number" && typeof to === "number" && from !== to) {
    const up = to > from;
    return h("span.ipl-val", `${to}`, " ", h("span.ipl-delta", { class: up ? "ipl-up" : "ipl-down" }, icon(up ? "fa-arrow-up" : "fa-arrow-down"), h("span", `${up ? "+" : "−"}${Math.abs(to - from)}`), sr(t(up ? "IPL.UI.Up" : "IPL.UI.Down"))));
  }
  return cellValue(to);
}
/** Rows [{label, before, after, from, to, long}] of the before/after table of an entry (empty array = no table). */
export function diffRows(e) {
  const d = e.d || {};
  const rows = [];
  const pair = (label, from, to, long) => rows.push({ label, from, to, long: !!long || (typeof from === "string" && from.length > 40) || (typeof to === "string" && to.length > 40) });
  switch (e.k) {
    case "stat.attr": case "stat.track": pair(keyLabel(d.key), d.from, d.to); break;
    case "stat.vital": pair(keyLabel(d.key) + (d.max != null ? ` / ${d.max}` : ""), d.from, d.to); break;
    case "stat.text":
      if (d.key === "biography") pair(keyLabel("biography"), Array.isArray(d.len) ? t("IPL.UI.LenChange", { a: d.len[0], b: d.len[1] }) : "", d.to ?? "", true);
      else pair(keyLabel(d.key), d.from, d.to, true);
      break;
    case "actor.rename": case "card.rename": pair(pathLabel("name"), d.from, d.to); break;
    case "access.owner": pair(d.name || String(d.user ?? ""), levelLabel(d.from), levelLabel(d.to)); break;
    case "access.default": pair(t("IPL.Type.access.default"), levelLabel(d.from), levelLabel(d.to)); break;
    case "item.edit": case "effect.edit":
      for (const c of objs(d.changes)) {
        if (Array.isArray(c.len)) pair(pathLabel(c.p), t("IPL.Sum.Characters", { n: c.len[0] }), t("IPL.Sum.Characters", { n: c.len[1] }));
        else pair(pathLabel(c.p), c.from, c.to);
      }
      break;
    case "damage.taken": pair(keyLabel("health"), d.from, d.to); break;
    case "damage.undone": pair(keyLabel("health"), d.from, d.to); break;
    case "combat.init": pair(t("IPL.Type.combat.init"), d.from, d.to); break;
    case "card.edit": pair(keyLabel(d.field), d.from, d.to, true); break;
    case "upgrade.status": pair(d.name || "", statusLabel(d.from), statusLabel(d.to)); break;
    case "upgrade.count": case "tracker.edit": pair(d.name || "", d.from, d.to); break;
    case "policy.change": pair(String(d.key ?? ""), d.from, d.to); break;
    default: break;
  }
  return rows;
}
function diffTable(rows) {
  const tbl = h("table.ipl-diff-table", h("caption.ipl-sr", t("IPL.UI.Details")),
    h("thead", h("tr", h("th", { scope: "col" }, t("IPL.UI.Field")), h("th", { scope: "col" }, t("IPL.UI.Before")), h("th", { scope: "col" }, t("IPL.UI.After")))));
  const body = h("tbody");
  for (const r of rows) body.append(h("tr", { class: r.long ? "ipl-long" : "" },
    h("th", { scope: "row", "data-label": t("IPL.UI.Field") }, r.label),
    h("td", { "data-label": t("IPL.UI.Before") }, cellValue(r.from)),
    h("td", { "data-label": t("IPL.UI.After") }, deltaCell(r.from, r.to))));
  tbl.append(body);
  return tbl;
}
function diceChips(d) {
  const dice = Array.isArray(d.dice) ? d.dice : [];
  if (!dice.length) return null;
  const ul = h("ul.ipl-dice", { "aria-label": t("IPL.UI.Dice") });
  for (const n of dice.filter((x) => typeof x === "number" || typeof x === "string")) {
    const kind = n === 6 ? "success" : n === 1 ? "bane" : "plain";
    ul.append(h("li.ipl-die", { class: `ipl-die-${kind}` }, h("span", { "aria-hidden": "true" }, String(n)), sr(t(kind === "success" ? "IPL.UI.DieSuccess" : kind === "bane" ? "IPL.UI.DieBane" : "IPL.UI.DieNeutral", { n }))));
  }
  const wrap = h("div.ipl-dice-wrap", ul);
  if (Array.isArray(d.hist) && d.hist.length) wrap.append(h("p.ipl-hist", `${t("IPL.UI.PushHistory")}: `, objs(d.hist).map((x) => `${tn("IPL.Plural.Success", Number(x.s) || 0)}${x.b ? `, ${tn("IPL.Plural.Bane", Number(x.b) || 0)}` : ""}`).join(" → ")));
  return wrap;
}
function groupedNames(list, more) {
  const by = new Map();
  for (const x of objs(list)) { const k = x.t || ""; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  const ul = h("ul.ipl-groups");
  for (const [type, arr] of by) ul.append(h("li", h("span.ipl-gtype", itemTypeLabel(type) || "—"), ": ", arr.map((x) => x.n + (x.l ? ` (${t("IPL.Sum.Level", { n: x.l })})` : "")).join(", ")));
  if (more) ul.append(h("li.ipl-muted", t("IPL.UI.MoreItems", { n: more })));
  return ul;
}
/** Children (bulk.change, log.gap, chargen.apply): returns a node or null. `fullKids` shows every child instead of the first 12. */
function childrenOf(e, ctx, fullKids) {
  const d = e.d || {};
  const kids = e.k === "bulk.change" ? objs(d.kids) : e.k === "log.gap" ? objs(d.changes) : null;
  if (Array.isArray(kids) && kids.length) {
    const cap = fullKids ? kids.length : 12;
    const ul = h("ul.ipl-kids");
    for (const k of kids.slice(0, cap)) {
      const ke = { id: `${e.id}~k`, t: e.t, u: e.u, k: typeof k.k === "string" ? k.k : "", d: k.d && typeof k.d === "object" && !Array.isArray(k.d) ? k.d : {}, n: k.n };
      ul.append(h("li", icon(iconClass(ke), "ipl-kid-ico"), h("span", sentenceNodes(ke, ctx, { kid: true }))));
    }
    const rest = kids.length - cap + (d.more || 0);
    const box = h("div.ipl-children", h("h4", t("IPL.UI.Children")), ul);
    if (rest > 0) {
      if (!fullKids && kids.length > cap) box.append(h("button.ipl-linkbtn", { type: "button", "data-ipl-act": "allkids", "data-ipl-id": e.id }, t("IPL.UI.ShowAllKids", { n: kids.length + (d.more || 0) })));
      else box.append(h("p.ipl-muted", t("IPL.UI.MoreItems", { n: rest })));
    }
    return box;
  }
  if (e.k === "chargen.apply") {
    const box = h("div.ipl-children");
    if (Array.isArray(d.add) && d.add.length) box.append(h("h4", t("IPL.UI.Added")), groupedNames(d.add, d.more?.add));
    if (Array.isArray(d.del) && d.del.length) box.append(h("h4", t("IPL.UI.Removed")), groupedNames(d.del, d.more?.del));
    return box.childElementCount ? box : null;
  }
  return null;
}
/** Detail panel for one entry. `links` = which action buttons exist (computed by the view); returns an element. */
export function detailOf(e, ctx, opts = {}) {
  const d = e.d || {};
  const panel = h("div.ipl-detail-inner");
  const meta = h("dl.ipl-meta");
  const row = (k, v) => { if (v != null && v !== "") meta.append(h("dt", k), h("dd", v)); };
  const who = (e.u ? ctx.userName(e.u) : t("IPL.UI.System")) + (e.rel ? ` (${t("IPL.UI.Relayed").toLowerCase()})` : "");
  panel.append(h("p.ipl-whenline", h("time", { datetime: new Date(e.t).toISOString() }, fmtFull(e.t) + (e.t2 && e.t2 - e.t > 2000 ? ` – ${fmtClock(e.t2)}` : "")), " · ", h("bdi", who)));
  if (d.cause && has(`IPL.Cause.${d.cause}`)) row(t("IPL.UI.Cause"), t(`IPL.Cause.${d.cause}`));
  if (d.src && has(`IPL.Src.${d.src}`)) row(t("IPL.UI.Source"), t(`IPL.Src.${d.src}`));
  if (e.k === "roll.made" && d.mode && has(`IPL.Mode.${d.mode}`)) row(t("IPL.Type.roll.made"), t(`IPL.Mode.${d.mode}`) + (d.str ? `, ${t("IPL.Out.Stress", { n: d.str })}` : "") + (d.st ? `, ${t("IPL.Out.Stunts", { n: d.st })}` : ""));
  if (e.a && e.rel) row(t("IPL.UI.Unverified"), t("IPL.UI.UnverifiedTip"));
  else if (e.a) row(t("IPL.UI.Approx"), t("IPL.UI.ApproxTip"));
  if (e.ua) row(t("IPL.UI.ChatDerived"), t("IPL.UI.ChatDerivedTip"));
  if (e.imp) row(t("IPL.UI.Imported"), t("IPL.UI.ImportedTip"));
  if (e.k === "damage.taken" && d.injury && d.injury.name) row(t("IPL.Cat.damage"), d.injury.name);
  if (meta.childElementCount) panel.append(meta);
  if (e.k === "note.add" || e.k === "note.gm") panel.append(h("blockquote.ipl-quote", h("bdi", fmtText(d.text))));
  const rows = diffRows(e);
  if (rows.length) panel.append(diffTable(rows));
  const dice = e.k === "roll.made" ? diceChips(d) : null;
  if (dice) panel.append(dice);
  const kids = childrenOf(e, ctx, opts.fullKids);
  if (kids) panel.append(kids);
  const notes = ctx.notesOn?.get?.(e.id);
  if (notes && notes.length) {
    const ul = h("ul.ipl-annots");
    for (const n of notes) ul.append(h("li", h("b.ipl-who", h("bdi", ctx.userName(n.u))), ": ", h("bdi", fmtText(n.d?.text))));
    panel.append(h("div.ipl-children", h("h4", t("IPL.UI.Notes")), ul));
  }
  return panel;
}
/** Which action buttons an entry offers: [{act, label, disabled, hint}] (the view adds Annotate / Redact for the GM). */
export function actionsOf(e, ctx) {
  const d = e.d || {};
  const out = [];
  if (d.msgId) {
    const alive = ctx.lookupMessage ? ctx.lookupMessage(d.msgId) : false;
    out.push({ act: "chat", id: d.msgId, label: t(alive ? "IPL.UI.ShowChat" : "IPL.UI.ChatGone"), disabled: !alive, icon: "fa-comment-dots" });
  }
  if (isItemType(e.k) && e.k !== "item.remove" && d.id) {
    const alive = !!ctx.actor?.(e)?.items?.get?.(d.id);
    out.push({ act: "item", id: d.id, label: t(alive ? "IPL.UI.OpenItem" : "IPL.UI.ItemGone"), disabled: !alive, icon: "fa-up-right-from-square" });
  }
  const aid = d.baseId || (e.k === "member.add" || e.k === "member.remove" ? d.id : null);
  if (aid) {
    const alive = !!globalThis.game?.actors?.get?.(aid);
    out.push({ act: "actor", id: aid, label: t(alive ? "IPL.UI.OpenActor" : "IPL.UI.ActorGone"), disabled: !alive, icon: "fa-up-right-from-square" });
  }
  return out;
}
export { uid, sr };
export const STAT_KEYS = { ATTRS, VITALS, TRACKS };
