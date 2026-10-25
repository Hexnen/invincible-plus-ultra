/* Team & Base card: the TAB-MODULE INTERFACE (phase B4). The base sheet (../sheet.mjs, an ActorSheetV2) knows nothing about what is inside a tab; it asks the
   modules listed in TABS, in order. Phases B5 (base), B6 (upgrades), B7 (events) and B8 (gear) each REPLACE one placeholder by a real module:
   change the import below, keep the default export shape, add the strings to ../lang.mjs (EN + PL, run ../check-lang.mjs).

   A tab module default-exports:
     {
       id:      "base" | "upgrades" | "events" | "gear"      // also the strings IPB.Tab.<id> (tab label)
       icon:    "fa-solid fa-..."                              // Font Awesome classes (shown beside the label; label only below 560px)
       render(ctx) -> string                                   // HTML of the tab body (any number of root elements; the window wraps it in the tabpanel)
       mount?(ctx, root)                                       // called after every paint of the body, root = the tabpanel element: attach listeners
                                                               // that are not delegated, init widgets. data-ipb-* attributes are free for the tab to use;
                                                               // the window only handles data-ipb="..." values it owns (tab, art, member*, create*, join, ...).
       badge?(ctx) -> string | number | ""                     // small count / fraction shown on the tab button ("2/2", 3); "" = none
       onDrop?(event, data, ctx) -> Promise<any|null>          // B8: an Item or a non-hero Actor dropped on the sheet while THIS tab is showing (sheet.mjs
                                                               // _onDropItem / _onDropActor); data = { type: "Item" | "Actor", document }. Heroes never arrive here
                                                               // (they join the team, drop.mjs). A tab without onDrop makes the sheet say which tab takes drops.
     }
   ctx (rebuilt on every paint, never cached by a tab):
     team      the normalized view { id, uuid, ...B } (read only: change it through ctx.update)
     B         same object as team (alias)
     actor     always null since B4b (the card is itself the sheet's actor; use ctx.members for heroes)
     members   Actor[] heroes linked to the team that this user may see; members.hidden = how many cannot be seen
     facts     member facts [{ id, name, resources, occupation, karma, reputation }] (only visible heroes)
     stats     pure.teamStats(facts) = { maxReputation:{value,who}, maxResources:{value,who}, karmaPool, occupations[] }
     canEdit   boolean, may this user write to the card (api.base.canEdit); a tab must show NO write control when false and print the reason
     isStaff   GM / assistant
     user      game.user
     api       game.modules.get("invincible-plus-ultra").api.base  (upgrades, karma, events, crate, vehicles, sync, catalog ...)
     update(patch, opts?) -> Promise<view|null>   store.update with the error shown as a notification (returns null when it failed); the window repaints
                                                  from the document update hook, a tab does not need to call rerender()
     run(promise) -> Promise                       shows the busy cursor while a longer operation runs and reports a BaseError as a notification
     rerender()                                    repaint the body now (focus is kept for elements with data-fk or name)
     announce(text)                                polite live-region message for screen readers (roll results, applied effects)
     go(tabId)                                     switch tab
     t(key, data), tn(key, n, data), esc(str), icon(classes)   strings, plural strings, HTML escape, <i aria-hidden> helper
   The sheet repaints the body when the card actor changes, EXCEPT while a text field inside the body has focus (it repaints on blur), so
   a tab can use "commit on change/blur" inputs without losing the cursor. Fields inside a tab should commit on change (blur/Enter), Escape reverts. */
import { base } from "./base.mjs";                                  // B5 (done)
import { upgrades } from "./upgrades.mjs";                          // B6 (done)
import { events } from "./events.mjs";                              // B7 (done)
import { gear } from "./gear.mjs";                                  // B8 (done)
import { log } from "./log.mjs";                                    // L5 (activity log project): the Log tab, last

export const TABS = [base, upgrades, events, gear, log];
export const tabById = (id) => TABS.find((x) => x.id === id) ?? TABS[0];
