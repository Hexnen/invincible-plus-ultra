/* Step "start": manual / roll a hero / start from this hero. Functional in phase 4 (the rest of the wizard is placeholders).
   Roll a hero = random.rollAll with the REAL provider (api.chargen.provider), then the wizard jumps to Review. Nothing is written to the actor here. */
import { t } from "../lang.mjs";
import { RANK_ORDER, RANKS } from "../rules.mjs";
import { setRank } from "../state.mjs";
import { createState } from "../state.mjs";
import { rollAll, newSeed } from "../random.mjs";
import { stateFromActor } from "../import.mjs";
import { esc, delegate, icon, rankName } from "./util.mjs";

const when = (ms) => { try { return new Date(ms).toLocaleString(globalThis.game?.i18n?.lang ?? undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return String(ms); } };

export default {
  id: "start",
  icon: "fa-solid fa-play",

  render(ctx) {
    const d = ctx.data, s = ctx.state, info = ctx.info;
    const hasData = !info.blank;
    const banner = hasData
      ? `<div class="ipc-banner" role="note">${icon("fa-solid fa-circle-info")}<p>${esc(t("IPC.Start.HasData", { name: ctx.actor.name, items: info.items, powers: info.counts.power, talents: info.counts.talent }))}</p></div>`
      : `<p class="ipc-lede">${esc(t("IPC.Start.Blank"))}</p>`;
    const draft = ctx.draft
      ? `<div class="ipc-banner ipc-banner-draft" role="note">${icon("fa-solid fa-floppy-disk")}<p>${esc(t("IPC.Start.Draft", { when: when(ctx.draft.at) }))}</p>
          <span class="ipc-banner-actions"><button type="button" class="ipc-btn ipc-btn-small" data-act="draft-continue">${esc(t("IPC.Start.DraftContinue"))}</button>
          <button type="button" class="ipc-btn ipc-btn-small ipc-btn-quiet" data-act="draft-discard">${esc(t("IPC.Start.DraftDiscard"))}</button></span></div>`
      : "";
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
            <label class="ipc-check"><input type="checkbox" name="within" data-fk="within"${d.within ? " checked" : ""}><span>${esc(t("IPC.Start.Roll.Within"))}</span></label>
          </div>
          <button type="button" class="ipc-btn ipc-btn-primary" data-act="roll" data-fk="roll"${d.rolling ? ' aria-disabled="true"' : ""}>${icon(d.rolling ? "fa-solid fa-spinner fa-spin-pulse" : "fa-solid fa-dice")} ${esc(t(d.rolling ? "IPC.Start.Roll.Busy" : "IPC.Start.Roll.Button"))}</button>
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
      } else if (act === "roll") {
        d.rolling = true; d.error = "";
        ctx.rerender();
        try {
          const base = createState({ seed: newSeed(), rank: ctx.state.rank, mode: "random" });
          const res = await ctx.busy(rollAll(base, ctx.provider(), { withinArchetype: !!d.within }));
          d.rolling = false;
          ctx.replace(res.state, { visitAll: true, go: "review" });
          ctx.announce(t("IPC.Start.Roll.Done", { name: res.state.heroName || ctx.actor.name }));
        } catch (err) {
          console.error("invincible-plus-ultra | chargen roll failed", err);
          d.rolling = false;
          d.error = t("IPC.Start.Roll.Failed", { error: err?.message ?? String(err) });
          ctx.rerender();
        }
      } else if (act === "hero") {
        ctx.replace(stateFromActor(ctx.actor, { seed: ctx.state.seed, rank: ctx.state.rank }), { visitAll: true, go: "rank" });
      } else if (act === "draft-continue") {
        ctx.restoreDraft();
      } else if (act === "draft-discard") {
        ctx.discardDraft();
        ctx.rerender();
      }
    });
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (el.name === "rollRank") ctx.update((s) => setRank(s, el.value), { touch: false });
      else if (el.name === "within") d.within = !!el.checked;
    });
  }
};
