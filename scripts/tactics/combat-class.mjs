/* Tactical combat: the module's own Combat class (spec 3.3, 17). It wraps whatever class is configured when it is installed
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
const tell = (env) => { const c = env?.error?.code; if (env && env.ok === false && c !== "noPrev" && c !== "nobodyActs") warn(errText(env.error)); else if (c === "noPrev") info(t("ITAC.Note.NoPrev")); else if (c === "nobodyActs") info(errText(env.error)); return env; };      // FXV (P8g-4): nobody can act: a note, not an error

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
        /* D97: as core does (client/documents/combat.mjs startCombat), but only for a fight that DID start: a refused or failed request
           tells nobody of a start, and the effect registry gets the combat as its context (durations are framed by it). */
        const env = tell(await Relay.request(this.id, { op: "start", restart: true }));
        if (!env?.ok) return this;
        try { this._playCombatSound?.("startEncounter"); } catch { /* no sound */ }
        try { Hooks.callAll("combatStart", this, { round: 1, turn: 0 }); } catch { /* a listener threw */ }
        try { await CONFIG.ActiveEffect.documentClass?.registry?.refresh?.("combatStart", { combat: this }); } catch { /* not in this core version */ }
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
          /* U17: the end of the scene is the ONE question of ending a fight (recover, end without, cancel): its answer ends the
             fight, Foundry's own "End combat?" is not asked on top of it (it left a fight with tactics already off when cancelled) */
          if ((await endSceneAsk(this)) === "cancel") return this;
          return this.delete();
        }
      } catch (e) { console.warn(`${MOD} | tactics endCombat`, e); }
      return super.endCombat();
    }
  };
}

/* D117: Foundry records every move of a token in a started combat (TokenDocument#_shouldRecordMovementHistory) and draws that trail,
   with the map's price label ("1 zone · 1 quick action") and a ghost of where it started, whenever the pointer rests on the token
   (base-ruler: `token.hover`). Core clears it at ITS turn start, which our card initiative never runs, so after a move or a drive the
   trail stood under the pointer for the rest of the round, reading like the price of a move still to make. In a fight that has the
   module's state the engine's ledger is the record of what was spent: Foundry keeps no trail. Pure (node: check-fxg). */
export const recordsTrail = (base, combat) => (tacticsState(combat) ? false : base);
let trailPatched = false;
function patchTrail() {
  try {
    const P = foundry.documents?.TokenDocument?.prototype ?? CONFIG.Token?.documentClass?.prototype;      // core's own: every token class inherits it (the system adds none)
    if (trailPatched || !P || typeof P._shouldRecordMovementHistory !== "function") return;
    const orig = P._shouldRecordMovementHistory;
    P._shouldRecordMovementHistory = function () { const base = orig.call(this); try { return recordsTrail(base, this.combatant?.parent ?? null); } catch { return base; } };
    trailPatched = true;
  } catch (e) { console.warn(`${MOD} | tactics movement trail`, e); }
}

/** Install the class (init). late = documents already exist (the dynamic import resolved after setup): existing combats are re-pointed
    at the new class and re-sorted; that path is a fallback and is not verified live. -> true when the class is in place */
export function install({ late = false } = {}) {
  try {
    patchTrail();
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
