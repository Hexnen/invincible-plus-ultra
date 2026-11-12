// node scripts/sweep-checks/fxs.mjs  (FXS: CSS findings T069-T078, the Szarża two-mark button U183, the held End press U178, the desk legend x)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const has = (src, s) => src.includes(s);

const ax = rd("../../styles/actors-extra.css"), ch = rd("../../styles/challenges.css"), chat = rd("../../styles/chat.css"), log = rd("../../styles/log.css");
const pl = rd("../../styles/pl.css"), chase = rd("../../styles/tactics-chase.css"), ui = rd("../../styles/tactics-ui.css"), dock = rd("../tactics/ui/dock.mjs");

/* T070: the focus tint on the challenge / vehicle header fields comes after the field rules that reset it, at their specificity */
const t070 = ".invincible.sheet.actor:is(.challenge, .vehicle) header.sheet-header .header-fields div :is(input, select, textarea):not(:disabled):focus {";
ck("T070 focus tint rule present", has(ax, t070) && /:not\(:disabled\):focus \{\s*background: #fffbd0;/.test(ax));
ck("T070 focus tint comes after the vehicle select rule", ax.indexOf(t070) > ax.lastIndexOf("padding-right: 18px"));

/* T071: under reduced motion the dock is visible at once on expand and hidden only after the fade on collapse */
ck("T071 expand: visibility without delay", has(ch, "#invincible-challenges .ich-dock { transition: opacity .15s linear, visibility 0s 0s; }"));
ck("T071 collapse: visibility after the fade", has(ch, "#invincible-challenges.ich-collapsed .ich-dock { transition: opacity .15s linear, visibility 0s .15s; }"));

/* T072: the narrow-card padding leaves the hero tile alone */
const narrow = chat.slice(chat.indexOf("@container isp-chat (max-width: 250px)"));
ck("T072 narrow padding skips the hero", /\[data-long\]:not\(:first-child\) \{ column-gap: 6px; padding-inline: 8px 8px; \}/.test(narrow) && !/\[data-long\] \{ column-gap: 6px/.test(narrow));

/* T073: the coloured <p>/<li> of the log beat the blanket inherit (after it, with .ipl in front) */
const inh = log.indexOf("S101");
ck("T073 error line red after the inherit", log.indexOf(".ipl .ipl-err-t { color: var(--ipl-red); }") > inh && inh > 0);
ck("T073 menu heads and session secondary", has(log, ".ipl :is(.ipl-menu-h, .ipl-session) { color: var(--ipl-text-2); }"));
ck("T073 bane die white", has(log, ".ipl .ipl-die-bane { color: #fff; }"));

/* T074: the Polish 'drop to add' is not put over the challenge's own 'takes no items' */
ck("T074 Polish drop text skips the challenge", has(pl, ".invincible.sheet.actor.isp-dropping:not(.challenge)::after"));

/* T075: the GM-tools rules that matched nothing are gone */
ck("T075 dead .itc-ends rule removed", !/\.itc-ends \{/.test(chase));
ck("T075 dead .itc-end rule removed", !/\.itc-end \{/.test(chase));

/* T076 / T077 / T078: the dock and desk rules carry the id, so the kit's reset no longer wins */
ck("T076 news close button id-scoped", has(ui, "#invincible-tactics-dock .itd-news-x {") && /\n\.itd-news-x \{/.test(ui) === false);
ck("T077 desk legend toggle id-scoped with a pressed state", has(ui, "#invincible-tactics-desk .igd-legend-b {") && has(ui, '#invincible-tactics-desk .igd-legend-b[aria-pressed="true"]'));
ck("T078 use row keeps its yellow left rule", has(ui, "#invincible-tactics-dock .itd-row.itd-row-sub { margin-left: 11px; border-left: 3px solid var(--ita-yellow); }"));
ck("FXS legend card x styled on the desk too", has(ui, ":is(#invincible-tactics-dock, #invincible-tactics-desk) .ita-sum-x {"));

/* U183: an action with a second cost (Szarża: full + quick) shows both marks, kept small */
ck("U183 dock builds both marks", /const speeds = \(cost, also\)/.test(dock) && /speeds\(a\.cost, a\.also\)/.test(dock));
ck("U183 two-mark pair sized down", has(ui, "#invincible-tactics-dock .itd-ic > .itd-also { --ipu-cost-h: 8px; }"));

/* U178: an End press shows as taken while the request is out */
ck("U178 End goes through endPress", /function endPress\(req\)/.test(dock) && /endPress\(e\.req\)/.test(dock));
ck("U178 held End has a look", has(ui, '#invincible-tactics-dock .itd-end.itd-end-held[aria-busy="true"] {'));

console.log(`sweep fxs: ${n} checks, ${f} failed`);
process.exitCode = f ? 1 : 0;
