/* Team & Base card, phase B3: the public API, game.modules.get("invincible-plus-ultra").api.base. Windows: open / openFor / pick come from entry.mjs (B4). A "team" argument is a JournalEntry, its id, its uuid or a view. Views are { id, uuid, ...normalized B }.
   All write methods re-check permissions and reject with BaseError { code, params } (codes: noBook noPermission tooBig noGM notFound invalid
   prerequisite stackMax full badInput blocked karma badType relay). */
import * as S from "./store.mjs";
import * as Cat from "./catalog.mjs";
import * as Sync from "./sync.mjs";
import * as Relay from "./relay.mjs";
import * as P from "./pure.mjs";
import { upgrades, karma, events, crate, vehicles } from "./ops.mjs";
import { t, tn } from "./lang.mjs";
import * as Entry from "./entry.mjs";

const MOD = S.MODULE_ID;
const LOG = `${MOD} (base) |`;

export const catalog = {
  upgrades: Cat.upgrades, upgrade: Cat.upgrade, audit: Cat.audit, available: Cat.available, invalidate: Cat.invalidate,
  eventsTable: Cat.eventsTable, cityTable: Cat.cityTable, bands: Cat.bands, rollEvent: Cat.rollEvent, rollCity: Cat.rollCity,
  teamBaseExamples: Cat.teamBaseExamples, rollTeamBase: Cat.rollTeamBase, teamNames: Cat.teamNames
};

export const baseApi = {
  /* windows (entry.mjs; the window code is imported on first use) */
  open: Entry.open, openFor: Entry.openFor, pick: Entry.pick,
  /* store */
  find: S.find, list: S.list, get: S.get, members: S.members, memberFacts: S.memberFacts,
  create: S.create, remove: S.remove, link: S.link, unlink: S.unlink, update: S.update, setPolicy: S.setPolicy,
  canEdit: S.canEdit, isStaff: S.isStaff, computeOwnership: S.computeOwnership, reconcileOwnership: S.reconcileOwnership,
  catalog, upgrades, karma, events, crate, vehicles,
  sync: { format: Sync.format, status: Sync.status, outOfDate: Sync.outOfDate, push: Sync.push, fromHero: Sync.fromHero, suggestLinks: Sync.suggestLinks },
  relay: { request: Relay.request, transport: Relay.transport, _runAs: Relay._runAs },
  BaseError: S.BaseError, pure: P, t, tn
};

export function attach() {
  const mod = game.modules.get(MOD);
  if (!mod) return;
  (mod.api ??= {});
  mod.api.base = baseApi;
}
