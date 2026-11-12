// node scripts/sweep-checks/q185.mjs  (FXQ: UX review 2 rows U185, U186, U187, U192 and the CSS sweep findings S095-S106)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const tryImport = async (p) => { try { return await import(new URL(p, import.meta.url)); } catch (e) { console.log("import failed", p, String(e).slice(0, 200)); return {}; } };

/* ---- U185: the bar over the macro bar beside a popped-out chat stays whole inside its room ---- */
const Lay = await tryImport("../tactics/ui/layout-pure.mjs");
const bc = Lay.barCentre ?? (() => NaN);
// the ux2 shot at 1920: room right of the chat 843..1860, bar 700 wide, macro bar centred at 960 -> the bar must start at 843 or later
ck("U185 bar over the macro bar keeps out of the chat", bc(843, 1860, 700, 960) - 350 >= 843);
ck("U185 bar over the macro bar where it fits stays over it", bc(100, 1800, 600, 960) === 960);
ck("U185 bar without a macro bar is centred in its room", bc(843, 1306, 400, null) === Math.round((843 + 1306) / 2));
ck("U185 bar kept off the right end", bc(100, 1000, 400, 990) + 200 <= 1000);
ck("U185 a bar wider than its room stays centred in it", bc(843, 1306, 600, 960) === Math.round((843 + 1306) / 2));
ck("U185 dock places by barCentre", /Lay\.barCentre\(lo, hi, /.test(rd("../tactics/ui/dock.mjs")) && !/Math\.max\(lo \+ 140, Math\.min\(hi - 140/.test(rd("../tactics/ui/dock.mjs")));

/* ---- U186: no first-fight player hints on a GM seat; the hint's place is kept only while a hint may still come ---- */
const FP = await tryImport("../tactics/ui/feedback-pure.mjs");
const t = (k) => k;
const turn = { show: true, onTurn: true, slots: [{ id: "full" }], groups: [{ id: "g" }], rolls: [] };
ck("U186 a player on the turn gets the slots hint", FP.hintOf?.(turn, [], t)?.id === "slots");
ck("U186 a GM seat on an NPC's turn gets none", FP.hintOf?.(turn, [], t, true) === null);
ck("U186 hintsLeft: GM never", FP.hintsLeft?.([], true) === false);
ck("U186 hintsLeft: player with hints unseen", FP.hintsLeft?.(["slots"], false) === true);
ck("U186 hintsLeft: player who has seen them all", FP.hintsLeft?.(["push", "slots", "speed"], false) === false);
ck("U186 feedback passes the seat", /FP\.hintOf\(data, seen, t, !!staff\)/.test(rd("../tactics/ui/feedback.mjs")));
ck("U186 the frame's hint place follows hintsLeft", /hintsOn: \(\) => Store\.setting\("tacticsHints", true\) !== false && Feedback\.hintsLeft\(/.test(rd("../tactics/ui/main.mjs")));

/* ---- U187: the "time is up" card says what Apply does when the challenge names no effect ---- */
const mp = rd("../tactics/ui/model-pure.mjs"), lang = rd("../tactics/lang.mjs");
ck("U187 card line for no effects", /else out\.push\(t\("ITAC\.ui\.line\.failNone"\)\)/.test(mp));
ck("U187 text in EN and PL", (lang.match(/"ITAC\.ui\.line\.failNone":/g) ?? []).length === 2 && /"ITAC\.ui\.line\.failNone": "Zastosuj zatrzyma zegar/.test(lang));

/* ---- U192: broken and the injury come before the stunts in a news row ---- */
const M = await tryImport("../tactics/ui/model-pure.mjs");
const view = { round: 1, news: [{ id: "n5_f1", kind: "action", actor: "a", name: "Hit", round: 1, rows: [{ target: "b", hit: true, taken: 16, stunts: ["doubleDamage"], down: true, crit: { n: 13, id: "torn" } }] }], knowledge: {} };
const txt = M.newsData?.(view, {}, { staff: false, c: (id) => ({ id, name: id }) }, (k, d) => k + (d ? JSON.stringify(d) : ""))?.text ?? "";
ck("U192 broken before the stunt", txt.indexOf("status.broken") > 0 && txt.indexOf("status.broken") < txt.indexOf("stunt.doubleDamage"));
ck("U192 injury before the stunt", txt.indexOf("float.crit") > 0 && txt.indexOf("float.crit") < txt.indexOf("stunt.doubleDamage"));

/* ---- CSS sweep findings ---- */
const chat = rd("../../styles/chat.css"), T = ":is(.roll-damage, .roll-critical, .roll-despair, .roll-blight, .roll-trauma, .roll-gear-damage, .roll-energy)";
ck("S095 no unfiltered nth-child count of the stat tiles", !/\.dice-infos:(?:not\()?:?has\(> :nth-child\(/.test(chat));
ck("S095 two-tile step-down counts tiles", chat.includes(`.dice-infos:has(> ${T}:nth-child(2)):not(:has(> ${T}:nth-child(3))) { --sl-k: 1.05; }`));
ck("S095 lone number counts tiles", chat.includes(`.dice-infos:not(:has(> ${T}:nth-child(2))) > :first-child .result {`));
const banner = chat.slice(chat.indexOf("& .message-content > div > strong:first-child:has(+ p) {"), chat.indexOf("& .message-content > div > p > strong:first-child"));
ck("S097 the banner declares no tilt / shadow it never shows", banner.length > 0 && !/(^|\s)(transform|box-shadow):/.test(banner));
const yz = chat.slice(chat.indexOf("li.chat-message.message .message-content .dice-roll:has(.dice-total:is(.success, .failure)) .dice-formula {"));
ck("S098 the first dice-toggle block declares no width / margin / shadow", yz.length > 0 && !/width: fit-content|margin-left: auto;\n|2px 2px 0/.test(yz.slice(0, yz.indexOf("}"))));
const dfx = rd("../../styles/diceeffects.css"), red = dfx.slice(dfx.indexOf("@media (prefers-reduced-motion: reduce)"));
ck("S099 reduced motion names the bold rays", /\.isp-dfx-six\.is-bold \.rays[^{]*\{ animation: none; \}/.test(red));
const ses = rd("../../styles/session.css");
ck("S100 blue headings as specific as the blanket rule", ses.includes(".ips-app :is(.ips-q-label, .ips-rlegend, .ips-count, .ips-start-h) { color: var(--ips-blue); }"));
ck("S100 grey hints as specific as the blanket rule", ses.includes(".ips-app :is(.ips-q-hint, .ips-rhead, .ips-s-note, .ips-yc-none, .ips-start-hint) { color: var(--ips-text-2); }"));
const narrow = ses.slice(ses.indexOf("@container ips (max-width: 419px)"));
ck("S102 narrow toast rule as specific as the base", narrow.includes(".ips-app p.ips-toast { left: 8px; right: 8px; }"));
ck("S102 narrow GM bar buttons as specific as the base", narrow.includes(".ips-bar-l button.ips-btn { min-width: 44px; padding: 0 10px; }") && narrow.includes(".ips-bar-l button.ips-btn { min-height: 40px; }"));
ck("S101 log secondary text as specific as the blanket rule", rd("../../styles/log.css").includes(".ipl :is(.ipl-count, .ipl-hint, .ipl-whenline, .ipl-hist, .ipl-state-b, .ipl-end) { color: var(--ipl-text-2); }"));
const tui = rd("../../styles/tactics-ui.css");
ck("S104 stepper reads aria-disabled", !/\.ita-step button[^{]*:disabled/.test(tui) && tui.includes('.ita-step button[aria-disabled="true"] {'));
ck("S105 end fill takes the real time", tui.includes("animation: itd-end-fill var(--itd-end-ms, 1.5s) linear forwards;") && /--itd-end-ms: \$\{autoDelay\(e\)\}ms/.test(rd("../tactics/ui/dock.mjs")));
const sp = rd("../../styles/sheet-plus.css");
ck("S106 reduced motion draws no landing ring", /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.invincible\.sheet\.actor \.isp-landed::after \{ display: none; \}/.test(sp));
ck("U188 the queue word drops its trailing space", rd("../tactics/ui/model-pure.mjs").includes('if (w.kind === "triggerQueue") return String(titleOf({ ...w, to: "player" }, t, facts)).trim();'));
ck("S096 no dead heading ink rule after the blanket inherit", !rd("../../styles/chat.css").includes(":is(h1, h2, h3, h4, h5, h6, strong, b) { color: var(--isp-ink); }"));

console.log(`sweep q185: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
