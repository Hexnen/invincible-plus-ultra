/* Team & Base card, phase B3: OPERATIONS on a card (no UI): upgrades, karma pooling purchase, base events, crate, vehicles.
   Every write re-checks permissions here (UI state is never trusted) and goes through store.update(), which validates and enforces the
   size / count limits. Rules logic comes from pure.mjs. */
import * as P from "./pure.mjs";
import * as S from "./store.mjs";
import * as Cat from "./catalog.mjs";
import * as EV from "./ev-pure.mjs";
import { t } from "./lang.mjs";
import { logRecord } from "./logrec.mjs";

const { BaseError } = S;
const MOD = S.MODULE_ID;
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const newId = () => foundry.utils.randomID(16);

/* B11 (A6, A7): one operation at a time per card on this client. Read-modify-write ops (karma.buy, crate.give, upgrades.add) queue here and re-read the card
   once they run, so two clicks / two parallel calls can neither spend the same karma nor hand out the same crate row twice. A queue cannot span two
   browsers: between two clients Foundry has no transaction, so the check-after-queue keeps the window to a network round trip. */
const queues = new Map();
export function withLock(key, fn) {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => {}, () => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

/* ================================================================== upgrades */
export const upgrades = {
  list(team) { return P.sortedList(S.data(team).upgrades); },
  allowance(team) { const B = S.data(team); return P.allowance(B.rank, B.upgrades); },

  /** Rules check for adding `key` (catalog key or "custom") to this team, as seen by `user`:
      { ok, met[], unmet[], reasons[], tooPricey, stack:{ok,count,max}, cost:{cost,kind,blocked}, entry } */
  async check(team, key, { power = "", user = game.user } = {}) {
    const B = S.data(team);
    const k = P.slug(key);
    const entry = k && k !== "custom" ? await Cat.upgrade(k) : null;
    const owned = P.sortedList(B.upgrades);
    let ev = { ok: true, tooPricey: false, reasons: [] };
    if (entry) ev = P.evalPrerequisite(entry.prereq, { members: S.memberFacts(team, user), owned });
    const stack = entry ? P.checkStack(entry, owned.filter((u) => u.key === entry.key), { power }) : { ok: true, count: 0, max: null };
    const met = ev.reasons.filter((r) => /Met$/.test(r.key));
    const unmet = ev.reasons.filter((r) => /Unmet$|Unknown$/.test(r.key));
    return { ok: ev.ok, met, unmet, reasons: ev.reasons, tooPricey: ev.tooPricey, stack, cost: P.upgradeCost(ev), entry };
  },
  async cost(team, key, opts = {}) { return (await upgrades.check(team, key, opts)).cost; },

  /** Add an upgrade. source "start" = a starting upgrade (editors; the stack limit and the starting allowance are enforced for non-staff, prerequisites are not: B11),
      "gm" = free grant (staff only, bypasses limits). Karma purchases go through karma.buy(). */
  add(team, key, opts = {}) {
    const e = S.resolve(team);
    return withLock(e.id, () => addUpgrade(e, key, opts));
  },
  async remove(team, uid, { user = game.user } = {}) {
    S.assertCanEdit(team, user);
    if (!S.data(team).upgrades[uid]) throw new BaseError("notFound", { id: uid });
    await S.update(team, { upgrades: { [`-=${uid}`]: null } }, { user });
    return true;
  },
  async setStatus(team, uid, status, { user = game.user } = {}) {
    S.assertStaff(user);                                                // B11 (A5): the install day and every status change are the GM's call (the tab already hides it)
    if (!P.STATUSES.includes(status)) throw new BaseError("badInput", { status });
    if (!S.data(team).upgrades[uid]) throw new BaseError("notFound", { id: uid });
    await S.update(team, { upgrades: { [uid]: { status } } }, { user });
    return status;
  },
  async setCount(team, uid, count, { user = game.user } = {}) {
    const u = S.data(team).upgrades[uid];
    if (!u) throw new BaseError("notFound", { id: uid });
    if (!Number.isInteger(count) || count < 1) throw new BaseError("badInput", { count });
    if (!S.isStaff(user)) {
      const def = await Cat.upgrade(u.key);
      if (def && def.max !== null && count > def.max) throw new BaseError("stackMax", { name: u.name, count, max: def.max });
    }
    await S.update(team, { upgrades: { [uid]: { count } } }, { user });
    return count;
  },
  async setNote(team, uid, note, { user = game.user } = {}) {
    await S.update(team, { upgrades: { [uid]: { note: String(note ?? "") } } }, { user });
    return true;
  }
};

/** The body of upgrades.add (no queue of its own: karma.buy already holds the card's lock when it calls this). */
async function addUpgrade(team, key, { source = "start", power = "", note = "", status, name = "", user = game.user, paid = 0, buy = null } = {}) {
  {
    const e = S.resolve(team);
    S.assertCanEdit(e, user);
    if (!P.SOURCES.includes(source)) throw new BaseError("badInput", { source });
    if (source === "gm" || source === "karma") S.assertStaff(user);
    const B = S.data(e);
    // B11 (A5): the starting allowance is a rule, not just a meter: a non-staff editor cannot go past it (staff may, the table can agree otherwise)
    if (source === "start" && !S.isStaff(user) && !(P.allowance(B.rank, B.upgrades).left > 0)) throw new BaseError("noAllowance", { total: P.allowance(B.rank, B.upgrades).total });
    const guard = P.canAdd(B, "upgrades");
    if (!guard.ok) throw new BaseError("full", { collection: "upgrades", cap: guard.cap });
    const k = P.slug(key) || "custom";
    const entry = k !== "custom" ? await Cat.upgrade(k) : null;
    if (k !== "custom" && !entry && await Cat.available()) throw new BaseError("badInput", { key });
    const display = entry?.name ?? String(name || key || "").trim();
    if (!display) throw new BaseError("badInput", { key });
    const grant = source === "gm";
    if (entry) {
      const stack = P.checkStack(entry, P.sortedList(B.upgrades).filter((u) => u.key === entry.key), { power, grant });
      if (!stack.ok) throw new BaseError("stackMax", { name: entry.name, count: stack.count, max: stack.max });
      if (!S.isStaff(user) && source === "start" && !P.START_IGNORES_PREREQ) {          // B11 (A15a): any starting upgrade is allowed; the switch lives in pure.mjs
        const ev = P.evalPrerequisite(entry.prereq, { members: S.memberFacts(e, user), owned: P.sortedList(B.upgrades) });
        if (ev.ok === false) throw new BaseError("prerequisite", { name: entry.name });
      }
    }
    // an identical stackable entry (same key and power) just counts up instead of adding a row
    const same = entry && P.sortedList(B.upgrades).find((u) => u.key === entry.key && (u.power || "") === (power || "") && u.source === source && (entry.max === null || entry.max > 1));
    if (same) {
      const patch = { count: same.count + 1, paid: same.paid + paid };
      if (buy) patch.buys = [...(Array.isArray(same.buys) ? same.buys : []), buy];      // B6: purchase log (when, price, who paid)
      await S.update(e, { upgrades: { [same.id]: patch } }, { user });
      return same.id;
    }
    const id = newId();
    await S.update(e, {
      upgrades: {
        [id]: {
          key: k, name: display, count: 1, power: String(power ?? ""), status: status ?? (source === "karma" ? "installing" : "active"),
          source, paid: Math.max(0, paid | 0), note: String(note ?? ""), sort: P.nextSort(B.upgrades), at: Date.now(),
          ...(buy ? { buys: [buy] } : {})
        }
      }
    }, { user });
    return id;
  }
}

/* ================================================================== karma */
export const karma = {
  /** Even split capped by each hero's karma -> [{actorId, amount}] or null when the pool is short. */
  plan(team, cost, { user = game.user } = {}) {
    return P.planKarma(S.memberFacts(team, user).map((m) => ({ id: m.id, karma: m.karma })), cost);
  },
  pool(team, { user = game.user } = {}) { return P.teamStats(S.memberFacts(team, user)).karmaPool; },

  /** Buy an upgrade with pooled karma. STAFF ONLY. split = [{actorId, amount}] (default: karma.plan). cost defaults to 10 / 20 (Too Pricey),
      opts.cost overrides. Karma is deducted from the heroes, then the upgrade is added (status "installing", paid = cost); if ANY step fails
      every hero is restored to the karma recorded before. `_failAt` ("afterKarma" | "card") forces a failure for tests only.
      Returns { id, cost, kind, split }. */
  async buy(team, key, split, opts = {}) {
    S.assertStaff(opts.user ?? game.user);
    const e = S.resolve(team);
    return withLock(e.id, () => buyKarma(e, key, split, opts));                   // B11 (A7): one purchase at a time per card; planning and reading the karma happen INSIDE the queue
  }
};

async function buyKarma(e, key, split, { power = "", cost: override = null, note = "", name = "", _failAt = null, user = game.user } = {}) {
  {
    const chk = await upgrades.check(e, key, { power, user });
    const c = P.upgradeCost(chk.ok === null ? { ok: null } : chk, Number.isInteger(override) ? override : null);
    if (c.blocked) throw new BaseError("blocked", { name: chk.entry?.name ?? key });
    if (!chk.stack.ok && !chk.entry?.gm) throw new BaseError("stackMax", { name: chk.entry?.name ?? key, count: chk.stack.count, max: chk.stack.max });
    const facts = S.memberFacts(e, user);
    const plan = split ?? P.planKarma(facts.map((m) => ({ id: m.id, karma: m.karma })), c.cost);
    if (!plan) throw new BaseError("karma", { cost: c.cost, pool: P.teamStats(facts).karmaPool, missing: c.cost - P.teamStats(facts).karmaPool });
    const v = P.validateSplit(plan, facts, c.cost);
    if (!v.ok) throw new BaseError("karma", { cost: c.cost, errors: v.errors, missing: v.missing });

    const done = [];                                                    // [{actor, before}]
    const restore = async () => { for (const d of done.reverse()) { try { await d.actor.update({ "system.karma": (Number(d.actor._source.system.karma) || 0) + d.amount }, { ipLogCause: "base-buy" }); } /* relative: puts back what WE took */ catch (er) { console.error(`${MOD} | base: karma rollback failed for ${d.actor.name}`, er); } } };
    try {
      for (const s of plan.filter((x) => x.amount > 0)) {
        const actor = game.actors.get(s.actorId);
        if (!actor) throw new BaseError("notFound", { id: s.actorId });
        const take = async () => {                                      // S5 (S4-13): read, check and write the hero's karma as ONE step under the session award's per-actor lock (when present), so an award cannot interleave
          const before = Number(actor._source.system.karma) || 0;     // _source: effect-modified numbers are never written back
          if (before < s.amount) throw new BaseError("karma", { cost: c.cost, missing: s.amount - before });
          await actor.update({ "system.karma": before - s.amount }, { ipLogCause: "base-buy" });    // L3b: the hero's karma row says WHY it dropped
          done.push({ actor, before, amount: s.amount });
        };
        const withLock = game.modules.get(MOD)?.api?.session?._internal?.Award?.withActorLock;
        if (typeof withLock === "function") await withLock(actor.id, take); else await take();
      }
      if (_failAt === "afterKarma") throw new Error("forced failure after karma");
      if (_failAt === "card") { await S.update(e, { upgrades: { zzfail: "bad" } }, { user }); }
      const buy = { at: Date.now(), paid: c.cost, kind: c.kind, split: plan.filter((x) => x.amount > 0).map((x) => ({ id: x.actorId, name: game.actors.get(x.actorId)?.name ?? "", amount: x.amount })) };
      const id = await addUpgrade(e, key, { source: "karma", power, note, name, paid: c.cost, buy, user });
      // L3b: ONE composite row on the base log (the passive upgrade.add / upgrade.count of this purchase are absorbed; each paying hero keeps its own karma row with cause "base-buy")
      logRecord(e, { k: "upgrade.buy", d: { key: P.slug(key) || "custom", name: chk.entry?.name ?? (name || String(key)), cost: c.cost, kind: c.kind, split: buy.split }, absorb: { actors: [e.id], types: ["upgrade."], ms: 5000 } });
      return { id, cost: c.cost, kind: c.kind, split: plan.filter((x) => x.amount > 0) };
    } catch (err) {
      await restore();
      throw err;
    }
  }
}

/* ================================================================== events */
const clampNote = (s) => P.clampText(s, 300);
export const events = {
  log(team) { return P.sortedList(S.data(team).events).sort((a, b) => b.at - a.at || b.sort - a.sort); },

  /** Roll the Base Events table (roll(), never draw()) and add a history entry with an effect PROPOSAL (applied:false).
      Posts to chat only when opts.chat === true and the card policy allows it. opts.total forces the D66 value (staff only, tests).
      Returns the new entry { id, ...entry }. */
  async roll(team, { label = "", mode = "", week = 0, chat = false, total, user = game.user, rerollOf = null } = {}) {
    const e = S.resolve(team);
    S.assertCanEdit(e, user);
    if (total !== undefined) S.assertStaff(user);
    const B = S.data(e);
    if (!S.isStaff(user)) {                                              // B11 (A5): the tab hides these from editors; the op refuses them as well
      if (rerollOf) throw new BaseError("noPermission");
      if (EV.pendingList(P.sortedList(B.events)).length) throw new BaseError("pending");
      chat = false;
    }
    const r = await Cat.rollEvent({ total });
    const proposal = P.proposeEffect(r.band, P.sortedList(B.upgrades).map((u) => ({ id: u.id, status: u.status })), { bandsOk: r.bandsOk });
    const id = newId();
    const entry = {
      at: Date.now(), label: String(label ?? "").slice(0, 60), mode: mode === "week" || mode === "any" ? mode : "", week: mode === "week" ? Math.max(0, Math.min(9999, Number(week) | 0)) : 0, roll: r.roll, band: r.band, resultId: r.resultId, text: clampNote(r.text),
      effect: proposal, resolved: false, rerolled: false, note: "", by: user.id, sort: P.nextSort(B.events)
    };
    const patch = { events: { [id]: entry } };
    const merged = { ...B.events, [id]: entry };
    for (const old of P.pruneEvents(merged)) if (old !== id) patch.events[`-=${old}`] = null;
    if (rerollOf && B.events[rerollOf]) patch.events[rerollOf] = { rerolled: true };
    await S.update(e, patch, { user });
    if (chat === true) await events.postChat(e, id, { user });
    return { id, ...entry };
  },
  /** Re-roll an event that does not fit the campaign: marks the old one rerolled and adds a new one. */
  async reroll(team, eid, opts = {}) {
    S.assertStaff(opts.user ?? game.user);
    if (!S.data(team).events[eid]) throw new BaseError("notFound", { id: eid });
    return events.roll(team, { label: S.data(team).events[eid].label, mode: S.data(team).events[eid].mode, week: S.data(team).events[eid].week, ...opts, rerollOf: eid });
  },
  /** Apply the proposed effect. STAFF ONLY, once, ONE document update (atomic). The change is exactly EV.plan(): a disabled upgrade must still be active,
      a broken one stays broken. Records effect.prev / appliedAt so the newest applied event can be undone with events.undo(). Returns { applied, patch, plan }. */
  async apply(team, eid, { user = game.user } = {}) {
    S.assertStaff(user);
    const B = S.data(team);
    const ev = B.events[eid];
    if (!ev) throw new BaseError("notFound", { id: eid });
    if (!ev.effect || ev.effect.applied || ev.effect.dismissed || ev.rerolled) throw new BaseError("badInput", { what: "effect" });
    const pl = EV.plan(ev.effect, B);
    const { rel, prev } = EV.patchOf(pl);
    const patch = { events: { [eid]: { effect: { applied: true, appliedAt: Date.now(), appliedBy: user.id, prev } } } };
    for (const [path, val] of Object.entries(rel)) foundry.utils.setProperty(patch, path, val);
    await S.update(team, patch, { user });
    return { applied: true, patch: rel, plan: pl };
  },
  /** Dismiss a pending proposal: the GM decided not to use it. STAFF ONLY. Nothing on the card changes. */
  async dismiss(team, eid, { user = game.user } = {}) {
    S.assertStaff(user);
    const ev = S.data(team).events[eid];
    if (!ev) throw new BaseError("notFound", { id: eid });
    if (!EV.isPending(ev)) throw new BaseError("badInput", { what: "effect" });
    await S.update(team, { events: { [eid]: { effect: { dismissed: true, dismissedAt: Date.now(), dismissedBy: user.id }, resolved: true } } }, { user });
    return true;
  },
  /** Pick other random upgrades for a pending disable / break proposal (same count). STAFF ONLY. */
  async repick(team, eid, { user = game.user, rng = Math.random } = {}) {
    S.assertStaff(user);
    const B = S.data(team);
    const ev = B.events[eid];
    if (!ev) throw new BaseError("notFound", { id: eid });
    if (!EV.isPending(ev) || !["disable", "break"].includes(ev.effect.kind)) throw new BaseError("badInput", { what: "effect" });
    const list = P.sortedList(B.upgrades);
    const pool = list.filter((u) => (ev.effect.kind === "disable" ? u.status === "active" : u.status === "active" || u.status === "installing")).map((u) => u.id);
    const n = ev.effect.kind === "disable" ? Math.max(1, ev.effect.rolled || ev.effect.upgrades.length || 1) : 1;
    await S.update(team, { events: { [eid]: { effect: { upgrades: P.pickDistinct(pool, n, rng) } } } }, { user });
    return true;
  },
  /** Undo the NEWEST applied effect while nothing it touched changed since (one step). STAFF ONLY. */
  async undo(team, eid, { user = game.user } = {}) {
    S.assertStaff(user);
    const B = S.data(team);
    if (!B.events[eid]) throw new BaseError("notFound", { id: eid });
    const ev = { id: eid, ...B.events[eid] };
    if (!EV.undoable(ev, P.sortedList(B.events), B)) throw new BaseError("badInput", { what: "undo" });
    const patch = { events: { [eid]: { effect: { applied: false, "-=prev": null, "-=appliedAt": null, "-=appliedBy": null } } } };
    for (const [path, val] of Object.entries(EV.undoPatch(ev, B))) foundry.utils.setProperty(patch, path, val);
    await S.update(team, patch, { user });
    return true;
  },
  async resolve(team, eid, resolved = true, { user = game.user } = {}) {
    if (!S.data(team).events[eid]) throw new BaseError("notFound", { id: eid });
    await S.update(team, { events: { [eid]: { resolved: !!resolved } } }, { user });
    return !!resolved;
  },
  async setNote(team, eid, note, { user = game.user } = {}) {
    await S.update(team, { events: { [eid]: { note: String(note ?? "") } } }, { user });
    return true;
  },
  /** Single chat card for an event (function only; callers decide when to post). Honors policy.chat: public / gm (whisper) / off (nothing). */
  async postChat(team, eid, { user = game.user } = {}) {
    const B = S.data(team);
    const ev = B.events[eid];
    if (!ev) throw new BaseError("notFound", { id: eid });
    if (B.policy.chat === "off") return null;
    const e = S.resolve(team);
    const content = `<div class="ipb-chat" data-team="${esc(e.id)}"><h3>${esc(t("IPB.Chat.Title", { team: B.name }))}</h3>`
      + `<p><strong>${esc(t("IPB.Chat.Roll", { roll: ev.roll }))}</strong>${EV.bandLow(ev.band) !== null && t(`IPB.Ev.Band.${EV.bandLow(ev.band)}`) !== `IPB.Ev.Band.${EV.bandLow(ev.band)}` ? ` - ${esc(t(`IPB.Ev.Band.${EV.bandLow(ev.band)}`))}` : ""}</p><p>${esc(ev.text)}</p>`
      + `<button type="button" data-action="ipb-open-team" data-team="${esc(e.id)}">${esc(t("IPB.Chat.Open"))}</button></div>`;
    const data = { content, speaker: ChatMessage.getSpeaker({ user }), author: user.id, flags: { [MOD]: { baseEvent: { team: e.id, event: eid } } } };
    if (B.policy.chat === "gm") data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
    return ChatMessage.create(data);
  }
};

/* ================================================================== crate */
const CRATE_BYTES_OVERHEAD = 256;
async function itemFrom(src) {
  if (!src) throw new BaseError("badInput", { what: "item" });
  if (typeof src === "string") return fromUuid(src);
  if (src.documentName === "Item") return src;
  if (src.type === "Item") {
    if (src.uuid) return fromUuid(src.uuid);
    if (src.data) return { synthetic: true, toObject: () => foundry.utils.deepClone(src.data), uuid: "", name: src.data.name, img: src.data.img, type: src.data.type, system: src.data.system ?? {} };
  }
  throw new BaseError("badInput", { what: "item" });
}
/** Hand one piece of a crate row to a hero / vehicle. B11 (A6): runs inside the card's queue and TAKES the piece from the crate FIRST (fresh read, then the
    write), then creates the item; if the item cannot be created the piece is put back. A second give of the same row can therefore never see the old quantity. */
async function giveRow(e, cid, target, user) {
  const B = S.data(e);
  const row = B.crate[cid];
  if (!row) throw new BaseError("notFound", { id: cid });
  const actor = typeof target === "string" ? game.actors.get(target) : target;
  if (!actor) throw new BaseError("notFound", { id: String(target) });
  if (!S.isStaff(user) && !actor.testUserPermission(user, "OWNER")) throw new BaseError("noPermission");
  if (!P.snapMatches(row)) throw new BaseError("badType", { type: row.type, target: actor.type });               // A13: the snapshot must be what the row says it is
  const isHero = actor.type === "superhero" && S.linkOf(actor) === e.id && row.type === "gear";
  const isVeh = actor.type === "vehicle" && row.type === "vehicleWeapon" && P.sortedList(B.vehicles).some((v) => v.uuid === actor.uuid);
  if (!isHero && !isVeh) throw new BaseError("badType", { type: row.type, target: actor.type });
  const doc = await Item.implementation.fromDropData({ type: "Item", data: foundry.utils.deepClone(row.snap) });
  const itemData = doc.toObject();
  if (row.qty > 1) await S.update(e, { crate: { [cid]: { qty: row.qty - 1 } } }, { user });
  else await S.update(e, { crate: { [`-=${cid}`]: null } }, { user });
  try {
    const [created] = await actor.createEmbeddedDocuments("Item", [itemData], { ipLogSrc: "transfer" });
    // L3b: "gave X to Rex" on the base log (absorbs the passive crate.qty / crate.remove of the same hand-over); the hero's own item.add stays, tagged "given from the base"
    logRecord(e, { k: "crate.give", d: { name: row.name, qty: 1, to: { id: actor.id, name: actor.name } }, absorb: { actors: [e.id], types: ["crate."], ms: 4000 } });
    return created;
  } catch (err) {
    const { id: _id, ...plain } = row;                                  // put the piece back (the row may have been removed meanwhile)
    const cur = S.data(e).crate[cid];
    try { await S.update(e, { crate: { [cid]: cur ? { qty: cur.qty + 1 } : { ...plain, qty: 1 } } }, { user }); } catch (er) { console.error(`${MOD} | base: crate.give could not put the piece back`, er); }
    throw err;
  }
}
export const crate = {
  list(team) { return P.sortedList(S.data(team).crate); },
  /** Add a gear / vehicleWeapon item (Item document, uuid, or a drop payload {type:"Item", uuid|data}) as a stripped snapshot. */
  async add(team, src, { qty = 1, note = "", user = game.user } = {}) {
    const e = S.resolve(team);
    S.assertCanEdit(e, user);
    const item = await itemFrom(src);
    if (!item) throw new BaseError("notFound", { id: String(src?.uuid ?? src) });
    if (!P.CRATE_TYPES.includes(item.type)) throw new BaseError("badType", { type: item.type });
    const B = S.data(e);
    const guard = P.canAdd(B, "crate");
    if (!guard.ok) throw new BaseError("full", { collection: "crate", cap: guard.cap });
    const snap = P.stripSnapshot(item.toObject());
    const sz = P.sizeGuard(B, P.byteSize(snap) + CRATE_BYTES_OVERHEAD);
    if (!sz.ok) throw new BaseError("tooBig", { bytes: sz.bytes, limit: sz.limit });
    const id = newId();
    await S.update(e, {
      crate: {
        [id]: {
          name: item.name, img: item.img ?? "", type: item.type, qty: Math.max(1, qty | 0), cost: Number.isInteger(item.system?.cost) ? item.system.cost : null,
          restricted: !!item.system?.restricted, note: String(note ?? ""), snap, src: item.uuid ?? "", sort: P.nextSort(B.crate), at: Date.now()
        }
      }
    }, { user });
    return id;
  },
  /** The payload a crate row drags onto a hero / vehicle sheet. */
  dragPayload(team, cid) {
    const row = S.data(team).crate[cid];
    if (!row) throw new BaseError("notFound", { id: cid });
    return { type: "Item", data: foundry.utils.deepClone(row.snap) };
  },
  /** Create the item on a member hero (gear) or a team vehicle (vehicleWeapon), then take one from the crate (row removed at 0). GM or owner of the target. */
  async give(team, cid, target, { user = game.user } = {}) {
    const e = S.resolve(team);
    S.assertCanEdit(e, user);
    return withLock(e.id, () => giveRow(e, cid, target, user));                  // B11 (A6): serialised per card
  },
  async setQty(team, cid, qty, { user = game.user } = {}) {
    if (!S.data(team).crate[cid]) throw new BaseError("notFound", { id: cid });
    if (!Number.isInteger(qty) || qty < 1) throw new BaseError("badInput", { qty });
    await S.update(team, { crate: { [cid]: { qty } } }, { user });
    return qty;
  },
  async setNote(team, cid, note, { user = game.user } = {}) {
    await S.update(team, { crate: { [cid]: { note: String(note ?? "") } } }, { user });
    return true;
  },
  async remove(team, cid, { user = game.user } = {}) {
    if (!S.data(team).crate[cid]) throw new BaseError("notFound", { id: cid });
    await S.update(team, { crate: { [`-=${cid}`]: null } }, { user });
    return true;
  }
};

/* ================================================================== vehicles */
export const vehicles = {
  list(team) { return P.sortedList(S.data(team).vehicles); },
  /** Add a world vehicle actor (Actor, id or uuid) as a reference. The first one becomes the primary team vehicle. */
  async add(team, src, { user = game.user } = {}) {
    const e = S.resolve(team);
    S.assertCanEdit(e, user);
    const a = typeof src === "string" ? (game.actors.get(src) ?? await fromUuid(src)) : src;
    if (!a || a.documentName !== "Actor" || a.type !== "vehicle" || S.isCard(a)) throw new BaseError("badType", { type: a?.type ?? "?" });   // a team base is itself a vehicle-typed actor: never a team vehicle
    if (!S.isStaff(user) && !a.testUserPermission(user, "LIMITED")) throw new BaseError("noPermission");
    const B = S.data(e);
    if (P.sortedList(B.vehicles).some((v) => v.uuid === a.uuid)) throw new BaseError("badInput", { what: "duplicate" });
    const guard = P.canAdd(B, "vehicles");
    if (!guard.ok) throw new BaseError("full", { collection: "vehicles", cap: guard.cap });
    const id = newId();
    await S.update(e, { vehicles: { [id]: { uuid: a.uuid, name: a.name, img: a.img ?? "", primary: !Object.keys(B.vehicles).length, note: "", sort: P.nextSort(B.vehicles) } } }, { user });
    return id;
  },
  async remove(team, vid, { user = game.user } = {}) {
    if (!S.data(team).vehicles[vid]) throw new BaseError("notFound", { id: vid });
    await S.update(team, { vehicles: { [`-=${vid}`]: null } }, { user });
    return true;
  },
  async setPrimary(team, vid, { user = game.user } = {}) {
    const B = S.data(team);
    if (!B.vehicles[vid]) throw new BaseError("notFound", { id: vid });
    const patch = { vehicles: {} };
    for (const id of Object.keys(B.vehicles)) patch.vehicles[id] = { primary: id === vid };
    await S.update(team, patch, { user });
    return vid;
  },
  /** Live stats of a vehicle (actor when visible, the stored name / img as fallback) with upgrade bonuses on the PRIMARY one. */
  stats(team, vid, { user = game.user } = {}) {
    const B = S.data(team);
    const v = B.vehicles[vid];
    if (!v) throw new BaseError("notFound", { id: vid });
    const a = fromUuidSync(v.uuid, { strict: false });
    const visible = !!a && (S.isStaff(user) || a.testUserPermission(user, "LIMITED"));
    const base = visible ? {
      passengers: Number(a.system.passengers) || 0, maneuverability: Number(a.system.maneuverability) || 0, speed: Number(a.system.speed) || 0,
      durability: Number(a.system.derived?.health?.max) || 0, armor: Number(a.system.armour) || 0
    } : {};
    const stats = P.vehicleStats(base, v.primary ? P.sortedList(B.upgrades) : []);
    const weapons = visible ? a.items.filter((i) => i.type === "vehicleWeapon").length : 0;
    const wpnUpgrades = P.sortedList(B.upgrades).filter((u) => u.key === "vehicle-weaponry").reduce((n, u) => n + u.count, 0);
    return { id: vid, name: visible ? a.name : v.name, img: visible ? a.img : v.img, visible, primary: v.primary, type: visible ? a.system.type : "", stats, weapons, weaponryUpgrades: wpnUpgrades };
  }
};
