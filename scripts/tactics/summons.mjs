/* Tactical combat, package P6: SUMMONED ALLIES AND COPIES ON THE TABLE (spec 6.7), the Foundry side. Runs on the executor's client only,
   called by engine.mjs for the host effects of engine-pure.mjs that create, remove or re-own a token and its combatant:
     summonFlag     who a combatant acts for [I14]                          -> op "summonFlag" (the journal writes back what stood there)
     summonCreate   a summoned group arrives next to its owner [B1808]      -> op "summon+" (undo: token and combatant go)
     summonRemove   a group leaves (dismissed, its owner broken, scene end) -> op "summon-" (undo: both come back with their ids)
     summonRestore  the undo of a leave
     tokenDelete / tokenCreate   the undo of a token the journal knows
   and for the copies of a duplicator [B1907]: `syncCopies` keeps one plain token per copy next to the owner. Those tokens are a picture
   of the state's copy bonus (the book runs copies as a bonus, not as characters): never combatants, never journaled, rebuilt from the
   state after every write, so an undo of the state is followed by them.
   No rule lives here. Everything is in try / catch: a failure warns and never breaks the table. */
import * as Store from "./store.mjs";
import * as Sys from "./system-adapter.mjs";
import * as Mv from "./movement.mjs";
import * as Zones from "./zones-adapter.mjs";
import { t } from "./lang.mjs";

const MOD = Store.MOD, OPT = { ipuTactics: true };
const flagOf = (d) => d?.flags?.[MOD]?.tactics ?? {};
const step = (scene) => scene?.grid?.size ?? 100;
/* a free place beside a token: the squares around it, the first one no token stands on */
function beside(scene, td, i = 0) {
  const g = step(scene), ring = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]];
  const taken = (x, y) => scene.tokens.some((o) => Math.abs(o.x - x) < g / 2 && Math.abs(o.y - y) < g / 2);
  const free = ring.map(([dx, dy]) => ({ x: td.x + dx * g * (td.width ?? 1), y: td.y + dy * g * (td.height ?? 1) })).filter((p) => !taken(p.x, p.y));
  return free[i % Math.max(1, free.length)] ?? { x: td.x + g, y: td.y };
}

export async function perform(combat, e, roster) {
  try {
    switch (e.t) {
      case "summonFlag": {
        const cb = combat.combatants.get(e.combatant);
        if (!cb) return {};
        const from = flagOf(cb).summonOf ?? null, to = e.owner ?? null;
        if (from !== to) { await cb.update({ [`flags.${MOD}.tactics.summonOf`]: to }, OPT); roster(combat); }
        return e.undo || from === to ? {} : { op: { t: "summonFlag", combatant: e.combatant, from, to } };
      }
      case "summonCreate": {
        const owner = combat.combatants.get(e.owner), ot = owner?.token, scene = ot?.parent;
        if (!ot || !scene) { ui.notifications?.warn(t("ITAC.warn.summonNoToken")); return { ok: false, reason: "noToken" }; }
        const name = t("ITAC.kit.summonName", { name: owner.name });
        const { actor, delta } = await Sys.summonGroup({ name, members: e.members, template: t("ITAC.kit.summonActor") }, Sys.actorOf(owner));
        const data = (await actor.getTokenDocument({ ...beside(scene, ot), elevation: ot.elevation, hidden: ot.hidden, disposition: ot.disposition, actorLink: false, name, delta })).toObject();
        const [tok] = await scene.createEmbeddedDocuments("Token", [data], OPT);
        const [cb] = await combat.createEmbeddedDocuments("Combatant", [{ tokenId: tok.id, sceneId: scene.id, actorId: actor.id, hidden: tok.hidden,
          flags: { [MOD]: { tactics: { summonOf: e.owner, summon: { kind: "summon", item: e.item ?? null, auto: 1, ...(e.delayed ? { delayed: 1 } : {}) } } } } }], OPT);
        const spot = Zones.available() ? Zones.spotOf(ot) : null;
        if (spot) await Mv.performMove({ t: "zput", who: cb.id, to: spot, group: [] }, (cid) => (cid === cb.id ? tok : combat.combatants.get(cid)?.token)).catch(() => {});      // the map stands it in its owner's zone
        return { op: { t: "summon+", combatId: combat.id, combatantId: cb.id, sceneId: scene.id, tokenId: tok.id }, result: { combatant: cb.id } };
      }
      case "summonRemove": {
        const cb = combat.combatants.get(e.combatant), scene = game.scenes.get(e.sceneId ?? cb?.sceneId), tok = scene?.tokens.get(e.tokenId ?? cb?.tokenId);
        if (!cb && !tok) return {};
        const op = { t: "summon-", combatId: combat.id, sceneId: scene?.id ?? null, combatant: cb?.toObject() ?? null, token: tok?.toObject() ?? null };
        if (cb) await combat.deleteEmbeddedDocuments("Combatant", [cb.id], OPT);
        if (tok) await scene.deleteEmbeddedDocuments("Token", [tok.id], OPT);
        return e.undo ? {} : { op };
      }
      case "summonRestore": {
        const scene = game.scenes.get(e.sceneId);
        if (scene && e.token && !scene.tokens.get(e.token._id)) await scene.createEmbeddedDocuments("Token", [e.token], { keepId: true, ...OPT });
        if (e.combatant && !combat.combatants.get(e.combatant._id)) await combat.createEmbeddedDocuments("Combatant", [e.combatant], { keepId: true, ...OPT });
        return {};
      }
      case "tokenDelete": { const s = game.scenes.get(e.sceneId); if (s?.tokens.get(e.tokenId)) await s.deleteEmbeddedDocuments("Token", [e.tokenId], OPT); return {}; }
      case "tokenCreate": { const s = game.scenes.get(e.sceneId); if (s && e.data) await s.createEmbeddedDocuments("Token", [e.data], { keepId: !!e.keepId, ...OPT }); return {}; }
      default: return {};
    }
  } catch (err) { console.warn(`${MOD} | tactics summons`, err); ui.notifications?.warn(t("ITAC.warn.summonFailed")); return {}; }
}

/* ------------------------------------------------------------------ the copies of a duplicator, as tokens (a picture of the state) */
const copyOf = (td) => flagOf(td).copyOf ?? null;
let busy = Promise.resolve();
/** Bring the copy tokens of every duplicator in line with the state: a few tokens beside the owner, none when the bonus is gone. */
export function syncCopies(combat, state) {
  busy = busy.then(async () => {
    try {
      if (!Store.iAmExecutor() || !combat) return;
      const want = new Map((state?.effects ?? []).filter((x) => x.kind === "copies" && Number(x.data?.n) > 0).map((x) => [x.holder, Math.min(3, Math.ceil(x.data.n / 3))]));      // the exact number does not matter [B1907]: one to three tokens, fewer as the bonus shrinks
      const scenes = new Set([...combat.combatants].map((cb) => cb.token?.parent).filter(Boolean));
      for (const scene of scenes) {
        const have = scene.tokens.filter((td) => copyOf(td)?.combat === combat.id);
        const gone = [], make = [];
        for (const [owner, n] of want) {
          const ot = combat.combatants.get(owner)?.token;
          if (!ot || ot.parent !== scene) continue;
          const mine = have.filter((td) => copyOf(td).owner === owner);
          gone.push(...mine.slice(n).map((td) => td.id));
          const far = mine.slice(0, n).filter((td) => Math.hypot(td.x - ot.x, td.y - ot.y) > step(scene) * 2.5 * Math.max(1, ot.width ?? 1) || td.elevation !== ot.elevation);      // the owner moved on: its copies follow
          for (const [i, td] of far.entries()) await td.update({ ...beside(scene, ot, i), elevation: ot.elevation }, { ...OPT, animate: false });
          for (let i = mine.length; i < n; i++) make.push({ ...ot.toObject(), ...beside(scene, ot, i), _id: undefined, actorLink: false, name: t("ITAC.kit.copyName", { name: ot.name }), alpha: 0.7, locked: true,
            bar1: { attribute: null }, bar2: { attribute: null }, displayBars: 0, flags: { [MOD]: { tactics: { copyOf: { combat: combat.id, owner } } } } });
        }
        gone.push(...have.filter((td) => !want.has(copyOf(td).owner)).map((td) => td.id));
        if (gone.length) await scene.deleteEmbeddedDocuments("Token", gone, OPT);
        if (make.length) await scene.createEmbeddedDocuments("Token", make, OPT);
      }
    } catch (err) { console.warn(`${MOD} | tactics copies`, err); }
  });
  return busy;
}
