/* Team & Base card, phase B3: the public API, game.modules.get("invincible-plus-ultra").api.base. Windows: open / openFor / pick come from entry.mjs (B4). A "team" argument is the base Actor (B4b: cards are actors), its id, its uuid or a view. Views are { id, uuid, ...normalized B }.
   All write methods re-check permissions and reject with BaseError { code, params } (codes: noBook noPermission tooBig noGM notFound invalid
   prerequisite stackMax full badInput blocked karma badType relay). */
import * as S from "./store.mjs";
import * as Cat from "./catalog.mjs";
import * as Sync from "./sync.mjs";
import * as Relay from "./relay.mjs";
import * as P from "./pure.mjs";
import * as X from "./xfer-pure.mjs";
import { upgrades, karma, events, crate, vehicles } from "./ops.mjs";
import { t, tn } from "./lang.mjs";
import * as Entry from "./entry.mjs";
import * as Dir from "./directory.mjs";
import * as Drop from "./drop.mjs";

const MOD = S.MODULE_ID;
const LOG = `${MOD} (base) |`;

export const catalog = {
  upgrades: Cat.upgrades, upgrade: Cat.upgrade, audit: Cat.audit, available: Cat.available, invalidate: Cat.invalidate,
  eventsTable: Cat.eventsTable, cityTable: Cat.cityTable, bands: Cat.bands, rollEvent: Cat.rollEvent, eventText: Cat.eventText, rollCity: Cat.rollCity,
  describingPrompts: Cat.describingPrompts, teamBaseExamples: Cat.teamBaseExamples, recommendedUpgrades: Cat.recommendedUpgrades, rollTeamBase: Cat.rollTeamBase, teamNames: Cat.teamNames
};

export const baseApi = {
  /* windows (entry.mjs; the window code is imported on first use) */
  open: Entry.open, openFor: Entry.openFor, pick: Entry.pick,
  /* store */
  find: S.find, list: S.list, get: S.get, members: S.members, memberFacts: S.memberFacts,
  create: S.create, remove: S.remove, link: S.link, unlink: S.unlink, update: S.update, setPolicy: S.setPolicy,
  canEdit: S.canEdit, isCard: S.isCard, cardById: S.cardById, migrate: S.migrate, createBase: Dir.createBase, isStaff: S.isStaff, computeOwnership: S.computeOwnership, reconcileOwnership: S.reconcileOwnership,
  rankOf: S.rankOf, heroRank: S.heroRank, dropHero: Drop.dropHero,                         // B4c: the team rank is derived from its members; dropHero(team, {type:"Actor"|"Token", uuid}) = add a hero
  catalog, upgrades, karma, events, crate, vehicles,
  sync: { format: Sync.format, status: Sync.status, outOfDate: Sync.outOfDate, push: Sync.push, fromHero: Sync.fromHero, suggestLinks: Sync.suggestLinks },
  relay: { request: Relay.request, transport: Relay.transport, _runAs: Relay._runAs, PROTO: Relay.PROTO },
  /* B9 (staff only; transfer.mjs is loaded on first use, so every call is async): exportDoc(team) -> document, exportToFile(team), importDoc(text|object, {members:false, keepVehicles, name})
     -> { team, name, report }, importFromFile() (needs a click), duplicate(team), confirmDelete(team), postSummary(team); pure = xfer-pure.mjs (parse / plan / portable) */
  transfer: Object.fromEntries(["exportDoc", "exportToFile", "importDoc", "importFromFile", "duplicate", "confirmDelete", "postSummary"].map((n) => [n, async (...a) => (await import("./transfer.mjs"))[n](...a)])),
  xfer: X,
  BaseError: S.BaseError, pure: P, t, tn
};

export function attach() {
  const mod = game.modules.get(MOD);
  if (!mod) return;
  (mod.api ??= {});
  mod.api.base = baseApi;
}
