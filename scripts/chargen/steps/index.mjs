/* STEP MODULES of the character-generator wizard (scripts/chargen/wizard.mjs). One file per step, one default export per file:
     steps/<id>.mjs   id in start | board (phase 6: the roll board, only in the stepper while the wizard is in random mode) | rank | concept | powers | talents | attributes | life | persona | team | review
   Phases 5a-5f (and 6/7) implement ONE step each by replacing that file; the shell (stepper, live preview, footer, history, draft, close
   confirm) is not touched. The window plate (title) and the one-line hint above the body come from lang keys IPC.Step.<id>.Title / .Hint
   (add/adjust them in lang.mjs, EN + PL, and run `node scripts/chargen/check-lang.mjs`).

   STEP MODULE INTERFACE
     export default {
       id: "rank",                                    // = file name
       icon: "fa-solid fa-ranking-star",              // FontAwesome, decorative
       async load(ctx)  {},                           // OPTIONAL. Runs when the step is entered and its data is not loaded yet (catalogue lists,
                                                      //   archetype pages ...). Store results in ctx.data (survives leaving / re-entering the step).
                                                      //   The shell shows a loading line meanwhile and an error + retry button when it throws.
       render(ctx)      { return "<html string>"; },  // REQUIRED, synchronous. The BODY of the step (title + hint are added by the shell).
                                                      //   Escape every dynamic value with esc() from steps/util.mjs. Controls: real <button type="button">,
                                                      //   <input>, <select> with a visible <label>; give controls that must keep focus across a
                                                      //   re-render a stable data-fk="<key>" (or name="...").
       mount(ctx, root) {},                           // OPTIONAL. After the body HTML is in the DOM; `root` = the .ipc-step element. Wire listeners
                                                      //   (delegate() from steps/util.mjs). They die with the body, no cleanup needed.
       onState(ctx)     {},                           // OPTIONAL. The state changed from OUTSIDE the step (undo / redo / roll / draft). The step
                                                      //   body is re-rendered afterwards; use it to invalidate caches kept in ctx.data.
     }

   CONTEXT (ctx, one object per step per window; its data persists)
     ctx.actor            the hero being built (document)        ctx.state     CURRENT wizard state (getter; shape: state.mjs header)
     ctx.rank             RANKS entry of the state's rank         ctx.derived   rules.derive(state, bonuses): health/resolve/slugfest/reputation/resources
     ctx.budget           rules.attributeBudget(state): { budget, spent, left, cap, canRaise(k), canLower(k) }
     ctx.issues           { errors[], warnings[], infos[] } of THIS step (rules.validate grouped by step); ctx.allIssues = every step
     ctx.update(fn, o)    commit  state = fn(state)  (pure helpers of state.mjs); pushes ONE undo step, marks the step as touched, repaints the
                          stepper / preview / footer. o = { coalesce:"key" (merge rapid edits such as typing into one undo step),
                          body:true (re-render this body too; focus is restored by data-fk / name), touch:false (do not mark touched) }
     ctx.commit(state, o) same with a ready state object      ctx.replace(state, { visitAll, go })  swap the whole state (roll a hero, import)
     ctx.rerender()       re-render this body only (focus restored)         ctx.go(stepId)   jump to a step
     ctx.announce(text)   polite screen-reader message                       ctx.busy(promise) shows the busy cursor until it settles
     ctx.provider()       the real provider (api.chargen.provider({ excludeActorId })), created once per window
     ctx.api              api.chargen = { tables, catalog, provider, apply }   ctx.catalog / ctx.apply  shortcuts
     ctx.data             object kept per step for the whole window (cache lists here)
     ctx.t / ctx.esc      lang t() and HTML escape
     ctx.app              the ChargenApp (markApplied(), close({force:true}))
   RULES OF THE SHELL: Next / Back never block (free navigation); the problems of a step show as badges in the stepper, in the preview and in the
   footer note; Review blocks Apply while rules.validate has errors (all attribute points must be spent). Never write to the actor from a step:
   only apply() (Review) does that.
*/
import start from "./start.mjs";
import rank from "./rank.mjs";
import concept from "./concept.mjs";
import powers from "./powers.mjs";
import talents from "./talents.mjs";
import attributes from "./attributes.mjs";
import life from "./life.mjs";
import persona from "./persona.mjs";
import team from "./team.mjs";
import review from "./review.mjs";
import board from "./board.mjs";

export const STEPS = { start, board, rank, concept, powers, talents, attributes, life, persona, team, review };
