/* Tactical combat (package P1): the module's own Combat class (spec 3.3, 17). It wraps whatever class is configured when it is installed
   (the system sets none, so normally the core Combat) and replaces what Year Zero Engine: Combat used to do for the turn order.
   A combat WITHOUT the module's state behaves exactly like the wrapped class, with one exception: starting it deals cards instead of
   leaving the order to rolled initiative.
   What it changes for a combat that has the state:
     - the order of combat.turns: ascending card [I1] [B2269], then the place inside a shared card [I4], combatants without a card last
       (challenges [I12], summons [I14]);
     - startCombat, nextTurn, nextRound, previousTurn go to the executor as requests (a player's nextTurn is "end my turn");
     - previousRound is refused: the cards of the round before are gone (hole, reported);
     - rolling or resetting initiative does nothing: cards are dealt by the round's draw;
     - endCombat offers the end-of-scene procedure first (spec 6.8).
   NOT VERIFIED LIVE (no Foundry in this package's tests): everything in this file. Core facts it relies on were read in
   client/documents/combat.mjs of Foundry 14: setupTurns() sorts with an UNBOUND this._sortCombatants (so the sort may not use `this`),
   a combatant update re-runs setupTurns on every client, and Combat.turn = null is the legal "nobody's turn". */
import * as Store from "./store.mjs";
import * as Relay from "./relay.mjs";
import { tacticsState } from "./source.mjs";
import { t, errText } from "./lang.mjs";

const MOD = Store.MOD;
let Wrapped = null, Own = null;
const warn = (text) => { try { ui.notifications.warn(text, { console: false }); } catch { /* no ui */ } };
const info = (text) => { try { ui.notifications.info(text, { console: false }); } catch { /* no ui */ } };
const tell = (env) => { if (env && env.ok === false && env.error?.code !== "noPrev") warn(errText(env.error)); else if (env?.error?.code === "noPrev") info(t("ITAC.Note.NoPrev")); return env; };

/** card order. No `this`: core calls it unbound. */
export function compareCombatants(a, b, base) {
  const combat = a?.parent ?? b?.parent;
  if (!tacticsState(combat)) return base ? base(a, b) : 0;
  const ia = Number.isFinite(a.initiative) ? a.initiative : Infinity, ib = Number.isFinite(b.initiative) ? b.initiative : Infinity;
  if (ia !== ib) return ia - ib;
  const pa = Number(a.flags?.[MOD]?.pos ?? 0), pb = Number(b.flags?.[MOD]?.pos ?? 0);
  if (pa !== pb) return pa - pb;
  return a.id > b.id ? 1 : a.id < b.id ? -1 : 0;
}

let endSceneAsk = null;
/** main.mjs hands over the dialog that offers the end-of-scene procedure: async (combat) => "done" | "skip" | "cancel" */
export const setEndSceneAsk = (fn) => { endSceneAsk = fn; };
/** is the module's own initiative in charge of new fights on this world? (the setting, and yze-combat not being the active tracker) */
export function ownInitiative() {
  try { return Store.setting("tacticsInitiative", true) !== false && !(game.modules.get("yze-combat")?.active && CONFIG.YZE_COMBAT); } catch { return false; }
}

export function makeClass(Base) {
  const baseSort = Base.prototype._sortCombatants;
  return class TacticsCombat extends Base {
    _sortCombatants(a, b) { return compareCombatants(a, b, baseSort); }

    async startCombat() {
      if (!ownInitiative()) return super.startCombat();
      try {
        try { this._playCombatSound?.("startEncounter"); } catch { /* no sound */ }
        try { Hooks.callAll("combatStart", this, { round: 1, turn: 0 }); } catch { /* a listener threw */ }
        const env = tell(await Relay.request(this.id, { op: "start", restart: true }));
        if (env?.ok) { try { CONFIG.ActiveEffect.documentClass?.registry?.refresh?.("combatStart"); } catch { /* not in this core version */ } }
      } catch (e) { console.warn(`${MOD} | tactics startCombat`, e); }
      return this;
    }
    async nextTurn() {
      const s = tacticsState(this);
      if (!s) return super.nextTurn();
      if (Store.isStaff(game.user)) tell(await Relay.request(this.id, { op: "nextTurn" }));
      else tell(await Relay.request(this.id, { op: "endTurn", actor: s.init.curMember ?? "", round: s.round, slot: s.init.cur ?? undefined }));
      return this;
    }
    async nextRound() {
      if (!tacticsState(this)) return super.nextRound();
      tell(await Relay.request(this.id, { op: "nextRound" }));
      return this;
    }
    async previousTurn() {
      if (!tacticsState(this)) return super.previousTurn();
      tell(await Relay.request(this.id, { op: "prevTurn" }));
      return this;
    }
    async previousRound() {
      if (!tacticsState(this)) return super.previousRound();
      info(t("ITAC.Note.NoPrevRound"));
      return this;
    }
    async rollInitiative(ids, options) {
      if (!tacticsState(this) && !ownInitiative()) return super.rollInitiative(ids, options);
      info(t("ITAC.Note.Cards"));
      return this;
    }
    async resetAll(options) {
      if (!tacticsState(this)) return super.resetAll(options);
      info(t("ITAC.Note.Cards"));
      return this;
    }
    async endCombat() {
      try {
        const s = tacticsState(this);
        if (s && s.phase !== "sceneEnd" && s.mode !== "off" && Store.iAmExecutor() && endSceneAsk) {
          if ((await endSceneAsk(this)) === "cancel") return this;
        }
      } catch (e) { console.warn(`${MOD} | tactics endCombat`, e); }
      return super.endCombat();
    }
  };
}

/** Install the class (init). late = documents already exist (the dynamic import resolved after setup): existing combats are re-pointed
    at the new class and re-sorted; that path is a fallback and is not verified live. -> true when the class is in place */
export function install({ late = false } = {}) {
  try {
    if (Own && CONFIG.Combat.documentClass === Own) return true;
    Wrapped = CONFIG.Combat.documentClass;
    Own = makeClass(Wrapped);
    CONFIG.Combat.documentClass = Own;
    if (late) {
      for (const c of game.combats ?? []) {
        try { if (!(c instanceof Own)) { Object.setPrototypeOf(c, Own.prototype); c.setupTurns?.(); } } catch (e) { console.warn(`${MOD} | tactics late install`, e); }
      }
    }
    return true;
  } catch (e) { console.warn(`${MOD} | tactics combat class not installed`, e); return false; }
}
export const installed = () => !!Own && CONFIG.Combat.documentClass === Own;
