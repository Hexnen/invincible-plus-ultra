/* Team & Base card, phase B3: OPERATIONS on a card (no UI): upgrades, karma pooling purchase, base events, crate, vehicles.
   Every write re-checks permissions here (UI state is never trusted) and goes through store.update(), which validates and enforces the
   size / count limits. Rules logic comes from pure.mjs. */
import * as P from "./pure.mjs";
import * as S from "./store.mjs";
import * as Cat from "./catalog.mjs";
import { t } from "./lang.mjs";

const { BaseError } = S;
const MOD = S.MODULE_ID;
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const newId = () => foundry.utils.randomID(16);

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

  /** Add an upgrade. source "start" = a starting upgrade (editors; prerequisites and stack limit enforced for non-staff),
      "gm" = free grant (staff only, bypasses limits). Karma purchases go through karma.buy(). */
  async add(team, key, { source = "start", power = "", note = "", status, name = "", user = game.user, paid = 0 } = {}) {
    const e = S.resolve(team);
    S.assertCanEdit(e, user);
    if (!P.SOURCES.includes(source)) throw new BaseError("badInput", { source });
    if (source === "gm" || source === "karma") S.assertStaff(user);
    const B = S.data(e);
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
      if (!S.isStaff(user) && source === "start") {
        const ev = P.evalPrerequisite(entry.prereq, { members: S.memberFacts(e, user), owned: P.sortedList(B.upgrades) });
        if (ev.ok === false) throw new BaseError("prerequisite", { name: entry.name });
      }
    }
    // an identical stackable entry (same key and power) just counts up instead of adding a row
    const same = entry && P.sortedList(B.upgrades).find((u) => u.key === entry.key && (u.power || "") === (power || "") && u.source === source && (entry.max === null || entry.max > 1));
    if (same) {
      await S.update(e, { upgrades: { [same.id]: { count: same.count + 1, paid: same.paid + paid } } }, { user });
      return same.id;
    }
    const id = newId();
    await S.update(e, {
      upgrades: {
        [id]: {
          key: k, name: display, count: 1, power: String(power ?? ""), status: status ?? (source === "karma" ? "installing" : "active"),
          source, paid: Math.max(0, paid | 0), note: String(note ?? ""), sort: P.nextSort(B.upgrades), at: Date.now()
        }
      }
    }, { user });
    return id;
  },
  async remove(team, uid, { user = game.user } = {}) {
    S.assertCanEdit(team, user);
    if (!S.data(team).upgrades[uid]) throw new BaseError("notFound", { id: uid });
    await S.update(team, { upgrades: { [`-=${uid}`]: null } }, { user });
    return true;
  },
  async setStatus(team, uid, status, { user = game.user } = {}) {
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
  async buy(team, key, split, { power = "", cost: override = null, note = "", name = "", _failAt = null, user = game.user } = {}) {
    S.assertStaff(user);
    const e = S.resolve(team);
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
    const restore = async () => { for (const d of done.reverse()) { try { await d.actor.update({ "system.karma": d.before }); } catch (er) { console.error(`${MOD} | base: karma rollback failed for ${d.actor.name}`, er); } } };
    try {
      for (const s of plan.filter((x) => x.amount > 0)) {
        const actor = game.actors.get(s.actorId);
        if (!actor) throw new BaseError("notFound", { id: s.actorId });
        const before = Number(actor._source.system.karma) || 0;       // _source: effect-modified numbers are never written back
        if (before < s.amount) throw new BaseError("karma", { cost: c.cost, missing: s.amount - before });
        await actor.update({ "system.karma": before - s.amount });
        done.push({ actor, before });
      }
      if (_failAt === "afterKarma") throw new Error("forced failure after karma");
      if (_failAt === "card") { await S.update(e, { rank: "nonsense" }, { user }); }
      const id = await upgrades.add(e, key, { source: "karma", power, note, name, paid: c.cost, user });
      return { id, cost: c.cost, kind: c.kind, split: plan.filter((x) => x.amount > 0) };
    } catch (err) {
      await restore();
      throw err;
    }
  }
};

/* ================================================================== events */
const clampNote = (s) => P.clampText(s, 300);
export const events = {
  log(team) { return P.sortedList(S.data(team).events).sort((a, b) => b.at - a.at || b.sort - a.sort); },

  /** Roll the Base Events table (roll(), never draw()) and add a history entry with an effect PROPOSAL (applied:false).
      Posts to chat only when opts.chat === true and the card policy allows it. opts.total forces the D66 value (staff only, tests).
      Returns the new entry { id, ...entry }. */
  async roll(team, { label = "", chat = false, total, user = game.user, rerollOf = null } = {}) {
    const e = S.resolve(team);
    S.assertCanEdit(e, user);
    if (total !== undefined) S.assertStaff(user);
    const B = S.data(e);
    const r = await Cat.rollEvent({ total });
    const proposal = P.proposeEffect(r.band, P.sortedList(B.upgrades).map((u) => ({ id: u.id, status: u.status })), { bandsOk: r.bandsOk });
    const id = newId();
    const entry = {
      at: Date.now(), label: String(label ?? ""), roll: r.roll, band: r.band, resultId: r.resultId, text: clampNote(r.text),
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
    if (!S.data(team).events[eid]) throw new BaseError("notFound", { id: eid });
    return events.roll(team, { label: S.data(team).events[eid].label, ...opts, rerollOf: eid });
  },
  /** Apply the proposed effect. STAFF ONLY, once. Returns { applied, patch }. */
  async apply(team, eid, { user = game.user } = {}) {
    S.assertStaff(user);
    const B = S.data(team);
    const ev = B.events[eid];
    if (!ev) throw new BaseError("notFound", { id: eid });
    if (!ev.effect || ev.effect.applied) throw new BaseError("badInput", { what: "effect" });
    const rel = P.effectPatch(ev.effect, B);                           // relative to B: "upgrades.<id>.status" | "base.occupied"
    const patch = { events: { [eid]: { effect: { applied: true } } } };
    for (const [path, val] of Object.entries(rel)) foundry.utils.setProperty(patch, path, val);
    await S.update(team, patch, { user });
    return { applied: true, patch: rel };
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
      + `<p><strong>${esc(t("IPB.Chat.Roll", { roll: ev.roll }))}</strong></p><p>${esc(ev.text)}</p>`
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
    const B = S.data(e);
    const row = B.crate[cid];
    if (!row) throw new BaseError("notFound", { id: cid });
    const actor = typeof target === "string" ? game.actors.get(target) : target;
    if (!actor) throw new BaseError("notFound", { id: String(target) });
    if (!S.isStaff(user) && !actor.testUserPermission(user, "OWNER")) throw new BaseError("noPermission");
    const isHero = actor.type === "superhero" && S.linkOf(actor) === e.id && row.type === "gear";
    const isVeh = actor.type === "vehicle" && row.type === "vehicleWeapon" && P.sortedList(B.vehicles).some((v) => v.uuid === actor.uuid);
    if (!isHero && !isVeh) throw new BaseError("badType", { type: row.type, target: actor.type });
    const doc = await Item.implementation.fromDropData({ type: "Item", data: foundry.utils.deepClone(row.snap) });
    const [created] = await actor.createEmbeddedDocuments("Item", [doc.toObject()]);
    try {
      if (row.qty > 1) await S.update(e, { crate: { [cid]: { qty: row.qty - 1 } } }, { user });
      else await S.update(e, { crate: { [`-=${cid}`]: null } }, { user });
    } catch (err) {
      await created.delete();                                          // roll the item back
      throw err;
    }
    return created;
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
