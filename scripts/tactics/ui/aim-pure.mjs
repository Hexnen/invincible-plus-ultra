/* perf4 (U140's cost): WHILE THIS USER AIMS the panels that are not the hand's own take no pointer (styles/tactics-slots.css). The rule
   used to read the page's own classes (`body.ita-tactics:is(.mm-z-picking, .itd-picking) :is(...) *`): a rule whose last part is `*`
   behind a class of <body> makes the browser restyle EVERY element of the page when that class comes or goes (~6000 with a long chat
   log: 85-140 ms on a player's page, on every arm, pick and cancel). The same answer is now written on the three panels' own roots
   (`data-ita-aim`), so a change restyles only what is inside them. The answer is the one the old selector gave, at the same moment
   (ui/aim.mjs writes it synchronously with each class change). */

/** the attribute on each root while this user aims */
export const ATTR = "data-ita-aim";
/** the roots of the panels that step back (the desk's `:not(.igd-busy)` and the dock's line slot stay in the CSS) */
export const ROOTS = Object.freeze(["invincible-challenges", "invincible-tactics-desk", "invincible-tactics-dock"]);
/** the old selector's condition on <body>: a fight's surfaces are up (ita-tactics) and a pick of the map or of the dock runs.
    `has(cls)`: whether <body> carries the class */
export const aimOn = (has) => !!has("ita-tactics") && (!!has("mm-z-picking") || !!has("itd-picking"));
/** what to write: [id, on] for every root whose attribute differs from the answer (`now(id)`: true / false, or null when the root is not there) */
export const changes = (on, now) => ROOTS.filter((id) => { const v = now(id); return v !== null && v !== undefined && v !== on; }).map((id) => [id, on]);
