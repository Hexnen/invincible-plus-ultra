/* Step "start": manual / roll a hero / start from this hero.
   Roll a hero = reroll.rollNewHero (random.rollAll with the REAL provider, api.chargen.provider) with the chosen rank / spice level / scope, then the wizard
   lands on the ROLL BOARD (phase 6; steps/board.mjs). "Surprise me" does the same with the remembered settings and no questions (also reachable from the
   sheet's 3-dot menu). Nothing is written to the actor here. */
import { t } from "../lang.mjs";
import { RANK_ORDER, RANKS } from "../rules.mjs";
import { setRank } from "../state.mjs";
import { rollNewHero, rollOptsOf, withSpice, withToggle, SPICES } from "../reroll.mjs";
import { stateFromActor } from "../import.mjs";
import { esc, delegate, icon, rankName } from "./util.mjs";

const when = (ms) => { try { return new Date(ms).toLocaleString(globalThis.game?.i18n?.lang ?? undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return String(ms); } };

/** roll a whole hero with the state's rank and roll settings and land on the roll board. Used by the buttons here and by the wizard's "Surprise me". */
export async function rollFor(ctx, { surprise = false } = {}) {
  const d = ctx.data, s = ctx.state;
  d.rolling = true; d.error = "";
  ctx.rerender();
  try {
    let member = null;
    try { member = ctx.api?.base?.find?.(ctx.actor)?.id ?? null; } catch { member = null; }   // a hero already in a team base keeps the card's texts
    const res = await ctx.busy(rollNewHero(ctx.provider(), { rank: s.rank, rollOpts: s.rollOpts, member }));
    d.rolling = false;
    ctx.replace(res.state, { visitAll: true, go: "board" });
    ctx.announce(t(surprise ? "IPC.Start.Surprise.Done" : "IPC.Start.Roll.Done", { name: res.state.heroName || ctx.actor.name }));
  } catch (err) {
    console.error("invincible-plus-ultra | chargen roll failed", err);
    d.rolling = false;
    d.error = t("IPC.Start.Roll.Failed", { error: err?.message ?? String(err) });
    ctx.rerender();
  }
}

export default {
  id: "start",
  rollFor,
  icon: "fa-solid fa-play",

  render(ctx) {
    const d = ctx.data, s = ctx.state, info = ctx.info;
    const hasData = !info.blank;
    const banner = hasData
      ? `<div class="ipc-banner" role="note">${icon("fa-solid fa-circle-info")}<p>${esc(t("IPC.Start.HasData", { name: ctx.actor.name, items: info.items, powers: info.counts.power, talents: info.counts.talent }))}</p></div>`
      : `<p class="ipc-lede">${esc(t("IPC.Start.Blank"))}</p>`;
    const draft = ctx.draft?.bad
      ? `<div class="ipc-banner ipc-banner-draft" role="alert">${icon("fa-solid fa-triangle-exclamation")}<p>${esc(t("IPC.Start.DraftBad"))}</p>
          <span class="ipc-banner-actions"><button type="button" class="ipc-btn ipc-btn-small" data-act="draft-discard" data-fk="draft-bad">${esc(t("IPC.Start.DraftBadDiscard"))}</button></span></div>`
      : ctx.draft
      ? `<div class="ipc-banner ipc-banner-draft" role="note">${icon("fa-solid fa-floppy-disk")}<p>${esc(t("IPC.Start.Draft", { when: when(ctx.draft.at) }))}</p>
          <span class="ipc-banner-actions"><button type="button" class="ipc-btn ipc-btn-small" data-act="draft-continue">${esc(t("IPC.Start.DraftContinue"))}</button>
          <button type="button" class="ipc-btn ipc-btn-small ipc-btn-quiet" data-act="draft-discard">${esc(t("IPC.Start.DraftDiscard"))}</button></span></div>`
      : "";
    const ro = rollOptsOf(s);
    const spices = [...SPICES, ...(ro.spice === "custom" ? ["custom"] : [])].map((k) => `<option value="${k}"${k === ro.spice ? " selected" : ""}>${esc(t(`IPC.Board.Spice.${k}`))}</option>`).join("");
    const ranks = RANK_ORDER.map((k) => `<option value="${k}"${k === s.rank ? " selected" : ""}>${esc(rankName(k))} (${RANKS[k].points} ${esc(t("IPC.Rank.PointsShort"))})</option>`).join("");
    return `<div class="ipc-start">
      ${banner}${draft}
      <div class="ipc-choices">
        <section class="ipc-choice ipc-choice-hand" aria-labelledby="ipc-c-hand">
          <div><h3 id="ipc-c-hand">${icon("fa-solid fa-pen-ruler")} ${esc(t("IPC.Start.Hand.Title"))}</h3><p>${esc(t("IPC.Start.Hand.Text"))}</p></div>
          <button type="button" class="ipc-btn ipc-btn-primary" data-act="manual" data-fk="manual">${esc(t("IPC.Start.Hand.Button"))}</button>
        </section>
        <section class="ipc-choice ipc-choice-roll" aria-labelledby="ipc-c-roll">
          <div><h3 id="ipc-c-roll">${icon("fa-solid fa-dice")} ${esc(t("IPC.Start.Roll.Title"))}</h3><p>${esc(t("IPC.Start.Roll.Text"))}</p></div>
          <div class="ipc-roll-opts">
            <label class="ipc-field"><span>${esc(t("IPC.Start.Roll.Rank"))}</span><select class="ipc-input" name="rollRank" data-fk="rollRank">${ranks}</select></label>
            <label class="ipc-field"><span>${esc(t("IPC.Start.Roll.Spice"))}</span><select class="ipc-input" name="rollSpice" data-fk="rollSpice" aria-describedby="ipc-spice-hint">${spices}</select></label>
            <label class="ipc-check"><input type="checkbox" name="within" data-fk="within"${ro.within ? " checked" : ""}><span>${esc(t("IPC.Start.Roll.Within"))}</span></label>
          </div>
          <p class="ipc-muted ipc-start-spice" id="ipc-spice-hint">${esc(ro.spice === "custom" ? t("IPC.Board.Spice.custom.Desc") : t(`IPC.Board.Spice.${ro.spice}.Desc`))}</p>
          <div class="ipc-start-btns">
            <button type="button" class="ipc-btn ipc-btn-primary" data-act="roll" data-fk="roll"${d.rolling ? ' aria-disabled="true"' : ""}>${icon(d.rolling ? "fa-solid fa-spinner fa-spin-pulse" : "fa-solid fa-dice")} ${esc(t(d.rolling ? "IPC.Start.Roll.Busy" : "IPC.Start.Roll.Button"))}</button>
            <button type="button" class="ipc-btn" data-act="surprise" data-fk="surprise"${d.rolling ? ' aria-disabled="true"' : ""} data-tooltip="${esc(t("IPC.Start.Surprise.Tip"))}">${icon("fa-solid fa-wand-sparkles")} ${esc(t("IPC.Start.Surprise.Button"))}</button>
          </div>
          ${d.error ? `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(d.error)}</p>` : ""}
        </section>
        ${hasData ? `<section class="ipc-choice ipc-choice-hero" aria-labelledby="ipc-c-hero">
          <div><h3 id="ipc-c-hero">${icon("fa-solid fa-user-pen")} ${esc(t("IPC.Start.Hero.Title"))}</h3><p>${esc(t("IPC.Start.Hero.Text"))}</p></div>
          <button type="button" class="ipc-btn" data-act="hero" data-fk="hero">${esc(t("IPC.Start.Hero.Button"))}</button>
        </section>` : ""}
      </div>
    </div>`;
  },

  mount(ctx, root) {
    const d = ctx.data;
    delegate(root, "click", "[data-act]", async (ev, el) => {
      if (el.getAttribute("aria-disabled") === "true") return;
      const act = el.dataset.act;
      if (act === "manual") {
        if (ctx.state.mode !== "manual") ctx.update((s) => ({ ...s, mode: "manual" }), { touch: false });
        ctx.go("rank");
      } else if (act === "roll" || act === "surprise") {
        await rollFor(ctx, { surprise: act === "surprise" });
      } else if (act === "hero") {
        const imported = stateFromActor(ctx.actor, { seed: ctx.state.seed, rank: ctx.state.rank });
        try {   // B4: drawbacks that ask for a choice are recognised from the catalogue (the sheet does not say)
          const known = new Map((await ctx.catalog.drawbacks()).map((e) => [e.name.toLowerCase(), e.needs]));
          imported.drawbacks = imported.drawbacks.map((x) => (known.get(x.name.toLowerCase()) ? { ...x, needs: known.get(x.name.toLowerCase()) } : x));
        } catch { /* no catalogue: no prompt */ }
        ctx.replace(imported, { visitAll: true, go: "rank" });
      } else if (act === "draft-continue") {
        ctx.restoreDraft();
      } else if (act === "draft-discard") {
        const bad = !!ctx.draft?.bad;
        ctx.discardDraft();
        ctx.rerender();
        if (bad) ctx.announce(t("IPC.Start.DraftBadNote"));
      }
    });
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (el.name === "rollRank") ctx.update((s) => setRank(s, el.value), { touch: false });
      else if (el.name === "rollSpice") ctx.update((s) => withSpice(s, el.value), { touch: false, body: true });
      else if (el.name === "within") ctx.update((s) => withToggle(s, "within", el.checked), { touch: false });
    });
  }
};
