/* Step "persona" (phase 5e): PERSONALITY (two distinct words), DRIVE, FLAW, HERO NAME, CIVILIAN NAME, IDENTITY and APPEARANCE.
   One scrolling column (same grammar as the powers / talents / life steps). Every field has the book's shortlist (the archetype's own list, or the union
   of all archetypes when there is none, with a switch), a dice button and free text.
   - Personality: two words from the D6 list (roll twice, a repeat is rolled again) or two free words; the chips toggle, the two inputs take typing.
   - Drive / flaw: written as "Name. book sentence" (the sentence is read from the creation tables at runtime, never stored in the module); the text
     area under the list is the single source of truth and takes free text; picking a row fills it.
   - Hero name: the archetype's three suggestions (chips) + free text + dice (it becomes the actor's name). Civilian name: free text + a seeded roll from
     the module-owned name lists (catalog provider "civilianNames"). Identity (secret / public) is the same state field the Concept step edits.
   - Appearance: one or two free sentences.
   AUTOSAVE: every text field commits into the wizard state ~220 ms after typing (one undo step per burst), at once on blur and before any button action
   (steps/shared.mjs bindAutosave); typing never re-renders the body, only the status line.
   DICE: seeded substreams (seed + state.rerolls counters persWords / persWord / drive / flaw / heroName / civName): undo restores the counters, so
   undo + roll again gives the same result. Lists are the creation tables in their D3 / D6 order; a roll is a uniform seeded pick over the rows. */
import { t } from "../lang.mjs";
import { validateStep, normName } from "../rules.mjs";
import { substream } from "../rng.mjs";
import { esc, icon, msgText, delegate } from "./util.mjs";
import { bindAutosave } from "./shared.mjs";

const nm = normName;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const PAGE = 6;
const textOf = (x) => (x ? (x.text ? `${x.name}. ${x.text}` : String(x.name ?? "")) : "");

/* ---------------------------------------------------------------- pieces */
function status(ctx) {
  const iss = validateStep(ctx.state, "persona");
  if (!iss.issues.length) return `<p class="ipc-status ipc-ok" data-status>${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Step.StatusOk"))}</p>`;
  const cls = (i) => (i.severity === "error" ? "ipc-iss-err" : i.severity === "info" ? "ipc-iss-info" : "ipc-iss-warn");
  return `<ul class="ipc-status-list" data-status>${iss.issues.map((i) => `<li class="${cls(i)}">${icon("fa-solid fa-circle-exclamation")}<span>${esc(msgText(i))}</span></li>`).join("")}</ul>`;
}
const die = (n) => `<span class="ipc-lf-die" aria-hidden="true">${n}</span>`;
const diceBtn = (act, label, tip, extra = "") => `<button type="button" class="ipc-btn ipc-btn-small" data-act="${act}" data-fk="${act}${extra ? `-${extra}` : ""}" data-tooltip="${esc(tip)}"${extra !== "" ? ` data-i="${esc(extra)}"` : ""}>${icon("fa-solid fa-dice")} ${esc(label)}</button>`;
const msgLine = (d, key) => `<p class="ipc-pw-msg" role="status" data-msg="${key}">${d.msgFor === key && d.msg ? `${icon("fa-solid fa-circle-info")} ${esc(d.msg)}` : ""}</p>`;
function switchSet(name, legend, options, current) {
  return `<fieldset class="ipc-opts ipc-opts-types ipc-tl-switch"><legend>${esc(legend)}</legend>${options.map((o) => `<label class="ipc-opt ipc-opt-chip${current === o.value ? " is-on" : ""}"><input type="radio" name="${name}" value="${esc(o.value)}" data-fk="${name}-${esc(o.value)}"${current === o.value ? " checked" : ""}><span class="ipc-opt-text"><span class="ipc-opt-name">${esc(o.label)}</span></span>${icon("fa-solid fa-check ipc-opt-check")}</label>`).join("")}</fieldset>`;
}
const tog = (label, on, attrs, aria) => `<button type="button" class="ipc-btn ipc-btn-small ipc-tog${on ? " is-on" : ""}" aria-pressed="${on}" ${attrs}${aria ? ` aria-label="${esc(aria)}"` : ""}>${icon(on ? "fa-solid fa-check" : "fa-solid fa-plus")} ${esc(label)}</button>`;

/* the three kinds of "list + sentence" fields share one renderer */
const KINDS = {
  drive: { field: "drive", src: "dsrc", lim: "dlimit", arch: "drvArch", all: "drvAll", counter: "drive" },
  flaw: { field: "flaw", src: "fsrc", lim: "flimit", arch: "flwArch", all: "flwAll", counter: "flaw" }
};
const kindList = (d, k) => (d[k.src] === "arch" && d[k.arch].length ? d[k.arch] : d[k.all]);

function sentenceSection(ctx, kind) {
  const d = ctx.data, s = ctx.state, k = KINDS[kind], cur = textOf(s[k.field]);
  const list = kindList(d, k), hasArch = d[k.arch].length > 0, shortList = d[k.src] === "arch" && hasArch;
  const shown = shortList ? list : list.slice(0, d[k.lim]);
  const sw = hasArch ? switchSet(`${kind}-src`, t("IPC.Persona.Source"), [{ value: "arch", label: t("IPC.Persona.SrcArch", { name: s.archetype ?? "", n: d[k.arch].length }) }, { value: "all", label: t("IPC.Persona.SrcAll", { n: d[k.all].length }) }], d[k.src]) : "";
  const rows = shown.map((e, i) => {
    const on = !!cur && nm(textOf(e)) === nm(cur);
    return `<li class="ipc-pw-row${on ? " is-added" : ""}${d.landed === `${kind}:${i}` ? " ipc-landed" : ""}">
      <div class="ipc-pw-row-main"><div class="ipc-pw-row-head">${shortList ? die(i + 1) : ""}<span class="ipc-pw-name">${esc(e.name)}</span></div>${e.text ? `<p class="ipc-pw-desc">${esc(e.text)}</p>` : ""}</div>
      <button type="button" class="ipc-btn ipc-btn-small${on ? "" : " ipc-btn-primary"}" data-act="use-${kind}" data-i="${i}" data-fk="${kind}-${i}" aria-pressed="${on}" aria-label="${esc(t(`IPC.Persona.${kind === "drive" ? "Drive" : "Flaw"}.UseAria`, { name: e.name }))}">${icon(on ? "fa-solid fa-check" : "fa-solid fa-plus")} ${esc(t(on ? "IPC.Persona.Using" : "IPC.Persona.Use"))}</button>
    </li>`;
  }).join("");
  const more = !shortList && list.length > shown.length ? `<li class="ipc-pw-morerow"><button type="button" class="ipc-btn ipc-btn-small" data-act="more-${kind}" data-fk="more-${kind}">${esc(t("IPC.Powers.Cat.More", { n: list.length - shown.length }))}</button></li>` : "";
  const K = kind === "drive" ? "Drive" : "Flaw";
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-ps-h-${kind}">
    <div class="ipc-cn-head"><h3 id="ipc-ps-h-${kind}" tabindex="-1">${esc(t(`IPC.Persona.${K}.Title`))}</h3>${diceBtn(`roll-${kind}`, t(`IPC.Persona.${K}.Roll`), t(shortList ? `IPC.Persona.${K}.RollTipArch` : `IPC.Persona.${K}.RollTipAll`, { n: list.length }))}</div>
    <p class="ipc-cn-sub">${esc(t(`IPC.Persona.${K}.Sub`))}</p>
    ${sw}${msgLine(d, kind)}
    ${rows || more ? `<ul class="ipc-pw-rows" data-list="${kind}">${rows}${more}</ul>` : ""}
    <label class="ipc-field"><span>${esc(t(`IPC.Persona.${K}.Field`))}</span><textarea class="ipc-input ipc-ps-area" name="${kind}-text" data-save="${kind}" data-fk="${kind}-text" rows="3" maxlength="400" autocomplete="off" placeholder="${esc(t(`IPC.Persona.${K}.Ph`))}">${esc(cur)}</textarea></label>
  </section>`;
}

/* ---- personality */
const persList = (d, s) => (d.psrc === "arch" && d.persArch.length ? d.persArch : d.persAll);
function personalitySection(ctx) {
  const d = ctx.data, s = ctx.state, words = s.personality ?? [];
  const list = persList(d, s), hasArch = d.persArch.length > 0;
  const sw = hasArch ? switchSet("pers-src", t("IPC.Persona.Source"), [{ value: "arch", label: t("IPC.Persona.SrcArch", { name: s.archetype ?? "", n: d.persArch.length }) }, { value: "all", label: t("IPC.Persona.SrcAll", { n: d.persAll.length }) }], d.psrc) : "";
  const dup = words.length === 2 && nm(words[0]) === nm(words[1]);
  const shown = list === d.persAll ? [...list].sort((x, y) => x.name.localeCompare(y.name)) : list;   // the long union list reads better alphabetically; the archetype's six keep their D6 order
  const chips = shown.map((e) => tog(e.name, words.some((w) => nm(w) === nm(e.name)), `data-act="toggle-word" data-word="${esc(e.name)}" data-fk="word-${esc(nm(e.name).replace(/[^a-z0-9]+/g, "-"))}"`)).join("");
  const input = (i) => `<div class="ipc-ps-word"><label class="ipc-field"><span>${esc(t("IPC.Persona.Pers.Word", { n: i + 1 }))}</span><input type="text" class="ipc-input" name="pw-${i}" data-save="pw" data-fk="pw-${i}" maxlength="30" autocomplete="off" value="${esc(words[i] ?? "")}"${dup ? ' aria-invalid="true"' : ""}></label>
      <button type="button" class="ipc-btn ipc-btn-small ipc-btn-icon" data-act="roll-word" data-i="${i}" data-fk="roll-word-${i}" data-tooltip="${esc(t("IPC.Persona.Pers.RollOneTip"))}" aria-label="${esc(t("IPC.Persona.Pers.RollOneAria", { n: i + 1 }))}">${icon("fa-solid fa-dice")}</button></div>`;
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-ps-h-pers">
    <div class="ipc-cn-head"><h3 id="ipc-ps-h-pers" tabindex="-1">${esc(t("IPC.Persona.Pers.Title"))}</h3>${diceBtn("roll-words", t("IPC.Persona.Pers.Roll"), t("IPC.Persona.Pers.RollTip", { n: list.length }))}</div>
    <p class="ipc-cn-sub">${esc(t("IPC.Persona.Pers.Sub"))}</p>
    ${sw}${msgLine(d, "pers")}
    <div class="ipc-ps-words">${input(0)}${input(1)}</div>
    <p class="ipc-error" role="alert" data-dup${dup ? "" : " hidden"}>${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Persona.Pers.Dup"))}</p>
    ${list.length > 12
      ? `<details class="ipc-ps-all" data-details="pall"${d.pallOpen ? " open" : ""}><summary>${esc(t("IPC.Persona.Pers.All", { n: list.length }))}</summary><div class="ipc-ps-chips" role="group" aria-label="${esc(t("IPC.Persona.Pers.ChipsAria"))}">${chips}</div></details>`
      : `<div class="ipc-ps-chips" role="group" aria-label="${esc(t("IPC.Persona.Pers.ChipsAria"))}">${chips}</div>`}
  </section>`;
}

/* ---- names, identity, appearance */
function idOpt(v, label, on) {
  return `<label class="ipc-opt${on ? " is-on" : ""}"><input type="radio" name="identity" value="${esc(v)}" data-fk="id-${v || "none"}"${on ? " checked" : ""}><span class="ipc-opt-text"><span class="ipc-opt-name">${esc(label)}</span></span>${icon("fa-solid fa-check ipc-opt-check")}</label>`;
}
function namesSection(ctx) {
  const d = ctx.data, s = ctx.state;
  const sugg = d.hnArch.length ? `<div class="ipc-ps-chips" role="group" aria-label="${esc(t("IPC.Persona.Hero.SuggAria"))}">${d.hnArch.map((e, i) => `${die(i + 1)}${tog(e.name, nm(s.heroName) === nm(e.name), `data-act="use-hero" data-i="${i}" data-fk="hero-${i}"`)}`).join("")}</div>` : "";
  const ident = [["", t("IPC.Identity.none")], ["secret", t("IPC.Identity.secret")], ["public", t("IPC.Identity.public")]].map(([v, l]) => idOpt(v, l, (s.identity ?? "") === v)).join("");
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-ps-h-names">
    <div class="ipc-cn-head"><h3 id="ipc-ps-h-names" tabindex="-1">${esc(t("IPC.Persona.Names.Title"))}</h3></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Persona.Names.Sub"))}</p>
    ${msgLine(d, "names")}
    <div class="ipc-ps-name">
      <label class="ipc-field"><span>${esc(t("IPC.Persona.Hero.Label"))}</span><input type="text" class="ipc-input" name="hero-name" data-save="heroName" data-fk="hero-name" maxlength="60" autocomplete="off" value="${esc(s.heroName)}"></label>
      ${diceBtn("roll-hero", t("IPC.Persona.Hero.Roll"), t(d.hnArch.length ? "IPC.Persona.Hero.RollTipArch" : "IPC.Persona.Hero.RollTipAll", { n: (d.hnArch.length ? d.hnArch : d.hnAll).length }))}
    </div>
    <p class="ipc-muted ipc-pw-hintline">${esc(t("IPC.Persona.Hero.Hint"))}</p>
    ${sugg}
    <div class="ipc-ps-name">
      <label class="ipc-field"><span>${esc(t("IPC.Persona.Civ.Label"))}</span><input type="text" class="ipc-input" name="civ-name" data-save="civilianName" data-fk="civ-name" maxlength="60" autocomplete="off" value="${esc(s.civilianName)}"></label>
      ${diceBtn("roll-civ", t("IPC.Persona.Civ.Roll"), t("IPC.Persona.Civ.RollTip"))}
    </div>
    <p class="ipc-muted ipc-pw-hintline">${esc(t("IPC.Persona.Civ.Hint"))}</p>
    <fieldset class="ipc-opts ipc-opts-id ipc-ps-id"><legend>${esc(t("IPC.Concept.Identity"))}</legend>${ident}</fieldset>
    <p class="ipc-muted ipc-pw-hintline">${esc(t("IPC.Concept.IdentityHint"))}</p>
  </section>
  <section class="ipc-pw-sec" aria-labelledby="ipc-ps-h-app">
    <div class="ipc-cn-head"><h3 id="ipc-ps-h-app" tabindex="-1">${esc(t("IPC.Persona.App.Title"))}</h3></div>
    <label class="ipc-field"><span>${esc(t("IPC.Persona.App.Label"))}</span><textarea class="ipc-input ipc-ps-area" name="appearance" data-save="appearance" data-fk="appearance" rows="3" maxlength="400" autocomplete="off" placeholder="${esc(t("IPC.Persona.App.Ph"))}">${esc(s.appearance)}</textarea></label>
  </section>`;
}

/* ---------------------------------------------------------------- data + dice */
async function syncArchetype(ctx) {
  const d = ctx.data, name = ctx.state.archetype ?? null;
  if (d.archFor === name) return false;
  d.archFor = name;
  d.persArch = []; d.drvArch = []; d.flwArch = []; d.hnArch = [];
  if (name) {
    try {
      const P = ctx.provider();
      const [p, dr, fl, hn] = await Promise.all(["personality", "drives", "flaws", "heroNames"].map((k) => P.list(k, { archetype: name })));
      if (d.archFor !== name) return false;
      d.persArch = p; d.drvArch = dr; d.flwArch = fl; d.hnArch = hn;
    } catch (err) { console.warn("invincible-plus-ultra | chargen: archetype lists failed", err); }
  }
  if (d.srcName !== name) { d.srcName = name; d.psrc = d.persArch.length ? "arch" : "all"; d.dsrc = d.drvArch.length ? "arch" : "all"; d.fsrc = d.flwArch.length ? "arch" : "all"; d.dlimit = PAGE; d.flimit = PAGE; }
  else { if (!d.persArch.length) d.psrc = "all"; if (!d.drvArch.length) d.dsrc = "all"; if (!d.flwArch.length) d.fsrc = "all"; }
  return true;
}

function nextFree(list, start, ok) {
  for (let i = 0; i < list.length; i++) { const e = list[(start + i) % list.length]; if (ok(e)) return e; }
  return null;
}
const said = (ctx, key, text) => { ctx.data.msgFor = key; ctx.data.msg = text; };

function rollSentence(ctx, kind) {
  const s = ctx.state, d = ctx.data, k = KINDS[kind], list = kindList(d, k);
  if (!list.length) return;
  const n = s.rerolls?.[k.counter] ?? 0;
  const idx = substream(s.seed, `${k.counter}:${n}`).int(list.length);
  const cur = nm(textOf(s[k.field]));
  const e = nextFree(list, idx, (x) => nm(textOf(x)) !== cur) ?? list[idx];
  const i = list.indexOf(e);
  d.landed = `${kind}:${i}`;
  said(ctx, kind, list.length <= 6 && d[k.src] === "arch" ? t("IPC.Life.Rolled", { die: i + 1, name: e.name }) : t("IPC.Life.RolledPlain", { name: e.name }));
  ctx.update((st) => ({ ...st, [k.field]: { name: e.name, text: e.text ?? "" }, rerolls: { ...st.rerolls, [k.counter]: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Persona.Rolled", { name: e.name }));
}

function rollWords(ctx) {
  const s = ctx.state, d = ctx.data, list = persList(d, s);
  if (list.length < 2) return;
  const n = s.rerolls?.persWords ?? 0;
  const rng = substream(s.seed, `persWords:${n}`);
  const a = rng.int(list.length);
  let b = rng.int(list.length);
  for (let i = 0; i < 24 && b === a; i++) b = rng.int(list.length);   // the book: roll twice, a repeat is rolled again
  if (b === a) b = (a + 1) % list.length;
  const w = [list[a].name, list[b].name];
  said(ctx, "pers", list.length <= 6 && d.psrc === "arch" ? t("IPC.Persona.Pers.RolledTwo", { a: a + 1, b: b + 1, x: w[0], y: w[1] }) : t("IPC.Persona.Pers.RolledPlain", { x: w[0], y: w[1] }));
  ctx.update((st) => ({ ...st, personality: w, rerolls: { ...st.rerolls, persWords: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Persona.Pers.RolledPlain", { x: w[0], y: w[1] }));
}
function rollWord(ctx, i) {
  const s = ctx.state, d = ctx.data, list = persList(d, s), words = [...(s.personality ?? [])];
  const other = nm(words[1 - i] ?? "");
  const pool = list.filter((e) => nm(e.name) !== other);
  if (!pool.length) return;
  const n = s.rerolls?.persWord ?? 0;
  const idx = substream(s.seed, `persWord:${n}`).int(pool.length);
  const e = nextFree(pool, idx, (x) => nm(x.name) !== nm(words[i] ?? "")) ?? pool[idx];
  if (words.length < i) words.length = i;
  words[i] = e.name;
  const next = words.filter(Boolean).slice(0, 2);
  said(ctx, "pers", t("IPC.Persona.Pers.RolledOne", { name: e.name }));
  ctx.update((st) => ({ ...st, personality: next, rerolls: { ...st.rerolls, persWord: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Persona.Pers.RolledOne", { name: e.name }));
}
function toggleWord(ctx, word) {
  const s = ctx.state, words = [...(s.personality ?? [])];
  const at = words.findIndex((w) => nm(w) === nm(word));
  if (at >= 0) words.splice(at, 1);
  else if (words.length < 2) words.push(word);
  else { said(ctx, "pers", t("IPC.Persona.Pers.Full")); ctx.rerender(); return; }
  ctx.data.msgFor = ""; ctx.data.msg = "";
  ctx.update((st) => ({ ...st, personality: words }), { body: true });
}

async function rollName(ctx, purpose, field, counter, list) {
  const s = ctx.state;
  const n = s.rerolls?.[counter] ?? 0;
  const rng = substream(s.seed, `${counter}:${n}`);
  let e = null, die = null;
  if (purpose === "civ") {
    try {
      const P = ctx.provider();
      if (typeof P.roll === "function") e = await P.roll("civilianNames", rng, { purpose: "hero" });
      if (!e?.name) { const l = await P.list("civilianNames", { purpose: "hero" }); e = rng.pick(l); }
    } catch (err) { console.warn("invincible-plus-ultra | chargen: name roll failed", err); }
  } else if (list.length) {
    const idx = rng.int(list.length);
    e = nextFree(list, idx, (x) => nm(x.name) !== nm(s[field])) ?? list[idx];
    if (list.length <= 6 && ctx.data.hnArch.length) die = list.indexOf(e) + 1;
  }
  if (!e?.name) { said(ctx, "names", t("IPC.Persona.NameFail")); ctx.rerender(); return; }
  said(ctx, "names", die ? t("IPC.Life.Rolled", { die, name: e.name }) : t("IPC.Persona.NameRolled", { name: e.name }));
  ctx.update((st) => ({ ...st, [field]: e.name, rerolls: { ...st.rerolls, [counter]: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Persona.NameRolled", { name: e.name }));
}

/* ---------------------------------------------------------------- the step */
export default {
  id: "persona",
  icon: "fa-solid fa-masks-theater",

  async load(ctx) {
    const d = ctx.data, P = ctx.provider();
    Object.assign(d, { persArch: [], drvArch: [], flwArch: [], hnArch: [], psrc: "all", dsrc: "all", fsrc: "all", dlimit: PAGE, flimit: PAGE, msg: "", msgFor: "", landed: null, archFor: undefined, srcName: undefined });
    [d.persAll, d.drvAll, d.flwAll, d.hnAll] = await Promise.all(["personality", "drives", "flaws", "heroNames"].map((k) => P.list(k, {})));
    await syncArchetype(ctx);
  },

  render(ctx) {
    return `<div class="ipc-powers ipc-persona">
      ${status(ctx)}
      ${personalitySection(ctx)}
      ${sentenceSection(ctx, "drive")}
      ${sentenceSection(ctx, "flaw")}
      ${namesSection(ctx)}
    </div>`;
  },

  mount(ctx, root) {
    const d = ctx.data;
    syncArchetype(ctx).then((changed) => { if (changed && root.isConnected) ctx.rerender(); });
    if (d.landed) { requestAnimationFrame(() => root.querySelector(".ipc-landed")?.scrollIntoView({ block: "nearest" })); d.landed = null; }

    const saver = bindAutosave(root, ctx, {
      apply(key) {
        const val = (name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
        if (key === "pw") {
          const words = [val("pw-0"), val("pw-1")].map(clean).filter(Boolean).slice(0, 2);
          ctx.update((st) => ({ ...st, personality: words }), { coalesce: "pw" });
          const dup = words.length === 2 && nm(words[0]) === nm(words[1]);
          const note = root.querySelector("[data-dup]"); if (note) note.hidden = !dup;
          root.querySelectorAll('[data-save="pw"]').forEach((el) => (dup ? el.setAttribute("aria-invalid", "true") : el.removeAttribute("aria-invalid")));
        } else if (key === "drive" || key === "flaw") {
          const v = val(`${key}-text`).replace(/[ \t]+/g, " ").trim();
          ctx.update((st) => ({ ...st, [key]: v ? { name: v, text: "" } : null }), { coalesce: key });
        } else if (key === "heroName" || key === "civilianName") {
          const v = clean(val(key === "heroName" ? "hero-name" : "civ-name"));
          ctx.update((st) => ({ ...st, [key]: v }), { coalesce: key });
        } else if (key === "appearance") {
          const v = val("appearance").replace(/[ \t]+/g, " ").trim();
          ctx.update((st) => ({ ...st, appearance: v }), { coalesce: "appearance" });
        }
      },
      after() { const st = root.querySelector("[data-status]"); if (st) st.outerHTML = status(ctx); }
    });

    root.addEventListener("toggle", (ev) => { if (ev.target?.dataset?.details === "pall") d.pallOpen = ev.target.open; }, true);   // "toggle" does not bubble
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLInputElement) || el.type !== "radio") return;
      if (el.name === "pers-src") { d.psrc = el.value; ctx.rerender(); }
      else if (el.name === "drive-src") { d.dsrc = el.value; d.dlimit = PAGE; ctx.rerender(); }
      else if (el.name === "flaw-src") { d.fsrc = el.value; d.flimit = PAGE; ctx.rerender(); }
      else if (el.name === "identity") {
        const v = el.value || null;
        if (v !== ctx.state.identity) ctx.update((st) => ({ ...st, identity: v }), { body: true });
      }
    });

    delegate(root, "click", "[data-act]", async (ev, el) => {
      saver.flush();
      const act = el.dataset.act, s = ctx.state;
      const kindOf = (a) => a.endsWith("drive") ? "drive" : "flaw";
      switch (act) {
        case "roll-words": rollWords(ctx); break;
        case "roll-word": rollWord(ctx, Number(el.dataset.i)); break;
        case "toggle-word": toggleWord(ctx, el.dataset.word); break;
        case "roll-drive": case "roll-flaw": rollSentence(ctx, kindOf(act)); break;
        case "use-drive": case "use-flaw": {
          const kind = kindOf(act), k = KINDS[kind], e = kindList(d, k)[Number(el.dataset.i)];
          if (!e) break;
          d.landed = `${kind}:${el.dataset.i}`; d.msgFor = ""; d.msg = "";
          ctx.update((st) => ({ ...st, [k.field]: { name: e.name, text: e.text ?? "" } }), { body: true });
          ctx.announce(t("IPC.Persona.Rolled", { name: e.name }));
          break;
        }
        case "more-drive": case "more-flaw": {
          const k = KINDS[kindOf(act)], first = d[k.lim]; d[k.lim] += PAGE; ctx.rerender();
          requestAnimationFrame(() => ctx.app.focusBody(`[data-fk="${kindOf(act)}-${first}"]`));
          break;
        }
        case "roll-hero": await rollName(ctx, "hero", "heroName", "heroName", d.hnArch.length ? d.hnArch : d.hnAll); break;
        case "roll-civ": await rollName(ctx, "civ", "civilianName", "civName", []); break;
        case "use-hero": {
          const e = d.hnArch[Number(el.dataset.i)];
          if (e && nm(s.heroName) !== nm(e.name)) { d.msgFor = ""; d.msg = ""; ctx.update((st) => ({ ...st, heroName: e.name }), { body: true }); ctx.announce(t("IPC.Persona.NameRolled", { name: e.name })); }
          break;
        }
        default: break;
      }
    });
  },

  onState(ctx) {
    const d = ctx.data;
    if (!d.persAll) return;
    d.msg = ""; d.msgFor = ""; d.landed = null; d.archFor = undefined;
  }
};
