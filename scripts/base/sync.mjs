/* Team & Base card, phase B3: SYNC. One-way mirror card -> heroes' system.team / system.teamBase (the card is the source of truth), plus
   adopting a card from a hero's existing text. The last value we pushed is kept on the hero (flags[...].base.pushed = {team, teamBase}) so a
   hero whose text was edited by hand since is a CONFLICT, never overwritten silently (pure.mirrorAction). No UI: the keep / replace decision
   comes from opts.resolve(conflicts) (B5 supplies a dialog); without it conflicts are reported and skipped. */
import * as P from "./pure.mjs";
import * as S from "./store.mjs";
import * as Cat from "./catalog.mjs";

const MOD = S.MODULE_ID;
const FIELDS = ["team", "teamBase"];
const pushedOf = (a) => a.flags?.[MOD]?.[P.FLAG_KEY]?.pushed ?? {};
const keptOf = (a) => a.flags?.[MOD]?.[P.FLAG_KEY]?.kept ?? {};        // card values the user declined for this hero ("keep my text")

/** The two texts the card writes onto a hero. */
export function format(team) {
  const B = S.data(team);
  return { team: P.formatTeam(B), teamBase: P.formatTeamBase(B) };
}

/** Per member and field: "same" | "push" | "conflict" | "kept" (a conflict the user already answered "keep" for this very card text;
    it turns back into "conflict" as soon as the card text changes). Only members the user can see. */
export function status(team, { user = game.user } = {}) {
  const want = format(team);
  return S.members(team, { user }).map((actor) => {
    const pushed = pushedOf(actor);
    const row = { actor, id: actor.id, name: actor.name, canWrite: S.isStaff(user) || actor.testUserPermission(user, "OWNER") };
    const kept = keptOf(actor);
    for (const f of FIELDS) {
      row[f] = P.mirrorAction(actor._source.system[f], pushed[f], want[f]);
      if (row[f] === "conflict" && kept[f] === want[f]) row[f] = "kept";
    }
    row.dirty = FIELDS.some((f) => row[f] !== "same" && row[f] !== "kept");
    return row;
  });
}
/** Heroes whose texts differ from the card (rows of status()). */
export const outOfDate = (team, opts) => status(team, opts).filter((r) => r.dirty);

/** Push the card texts to the heroes `user` may write. Honors policy.syncHeroes unless opts.force.
    opts.resolve(conflicts: [{actor, field, current, next}]) -> Promise<{ "<actorId>.<field>": "keep"|"replace" }>; no resolver => conflicts are skipped.
    opts.force replaces everything. Returns { pushed:[{id,fields}], conflicts:[{id,field,decision}], skipped:[id] (not writable), unchanged:[id], disabled }. */
export async function push(team, { force = false, resolve = null, user = game.user } = {}) {
  const B = S.data(team);
  const out = { pushed: [], conflicts: [], skipped: [], unchanged: [], disabled: false };
  if (!B.policy.syncHeroes && !force) { out.disabled = true; return out; }
  const want = format(team);
  const rows = status(team, { user });
  const open = [];
  for (const r of rows) {
    if (!r.canWrite) { if (r.dirty) out.skipped.push(r.id); continue; }
    for (const f of FIELDS) if (r[f] === "conflict" && !force) open.push({ actor: r.actor, field: f, current: r.actor._source.system[f], next: want[f] });
  }
  let decisions = {};
  if (open.length && typeof resolve === "function") decisions = (await resolve(open.map((c) => ({ ...c })))) ?? {};
  for (const r of rows.filter((x) => x.canWrite)) {
    const upd = {};
    const fields = [];
    const pushed = { ...pushedOf(r.actor) };
    const kept = { ...keptOf(r.actor) };
    for (const f of FIELDS) {
      const act = r[f];
      if (act === "kept" && !force) continue;
      if (act === "same") { if (pushed[f] !== want[f]) pushed[f] = want[f]; continue; }
      if (act === "push" || force) { upd[`system.${f}`] = want[f]; pushed[f] = want[f]; fields.push(f); continue; }
      const d = decisions[`${r.id}.${f}`] ?? "pending";
      out.conflicts.push({ id: r.id, field: f, decision: d });
      if (d === "replace") { upd[`system.${f}`] = want[f]; pushed[f] = want[f]; fields.push(f); }
      else if (d === "keep") kept[f] = want[f];                                          // stop asking until the card text changes again
    }
    const same = JSON.stringify(pushed) === JSON.stringify(pushedOf(r.actor)) && JSON.stringify(kept) === JSON.stringify(keptOf(r.actor));
    if (!fields.length && same) { out.unchanged.push(r.id); continue; }
    upd[`flags.${MOD}.${P.FLAG_KEY}.pushed`] = pushed;
    upd[`flags.${MOD}.${P.FLAG_KEY}.kept`] = kept;
    await r.actor.update(upd, { ipbSync: true });                      // B4d: the lock guard (lock.mjs) lets only the sync write the mirrored fields
    if (fields.length) out.pushed.push({ id: r.id, fields });
    else out.unchanged.push(r.id);
  }
  return out;
}

/** Heroes whose normalized system.team equals the card name but are not linked (offered to the user, never automatic). */
export function suggestLinks(team) {
  const e = S.resolve(team);
  const name = e.name.trim().toLowerCase();
  if (!name) return [];
  return game.actors.filter((a) => a.type === "superhero" && !S.linkOf(a) && P.parseTeam(a._source.system.team).toLowerCase() === name);
}

/** Adopt a card from a hero's existing text (system.team / system.teamBase) and link it.
    opts: { rank, upgrades: [names] (extra starting upgrades), name }. A hero already in a team returns that team. Needs card-creation rights (relayed for players). */
export async function fromHero(actorRef, opts = {}) {
  const actor = typeof actorRef === "string" ? game.actors.get(actorRef) : actorRef;
  if (!actor || actor.type !== "superhero") throw new S.BaseError("badInput", { what: "actor" });
  const existing = S.find(actor);
  if (existing) return existing;
  const cat = await Cat.upgrades();
  const parsed = P.parseTeamBase(actor._source.system.teamBase, cat);
  const team = await S.create({ name: opts.name ?? P.parseTeam(actor._source.system.team), rank: opts.rank, fromActor: actor });
  const extra = (opts.upgrades ?? []).map((n) => ({ key: "", name: n, count: 1, power: "" }));
  const ups = [...parsed.upgrades, ...extra];
  const patch = { base: { kind: parsed.kind, where: parsed.where }, upgrades: {} };
  let sort = 1;
  for (const u of ups) {
    const def = u.key && u.key !== "custom" ? cat.find((c) => c.key === u.key) : cat.find((c) => c.name.toLowerCase() === u.name.toLowerCase());
    patch.upgrades[foundry.utils.randomID(16)] = {
      key: def?.key ?? "custom", name: def?.name ?? u.name, count: u.count, power: u.power, status: "active", source: "start",
      paid: 0, note: "", sort: sort++, at: Date.now()
    };
  }
  const view = await S.update(team.id, patch, { user: game.user });
  // the hero's current text came from the player: remember it as the last pushed value so it is never reported as a conflict
  // (a later push just normalizes the wording)
  await actor.update({ [`flags.${MOD}.${P.FLAG_KEY}.pushed`]: { team: String(actor._source.system.team ?? ""), teamBase: String(actor._source.system.teamBase ?? "") } });
  return S.view(view.id);
}
