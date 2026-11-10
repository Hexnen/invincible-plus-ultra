/* Tactical combat (package P1): the MINIMAL prompt dialogs of P1 (Combat Veteran, Fast Reflexes, the GM's trigger queue, consent to a
   granted action, a challenge whose time is up) and the end-of-scene confirmation. Plain DialogV2 windows that reuse the look of the
   turn dialogs (classes itn-dialog, itn-body, itn-never from styles/turn.css); the designed prompt bar and GM desk come with package P4
   and replace this file. Nothing here decides anything: a click is a request to the executor (api.tactics.answer / endScene).
   NOT VERIFIED LIVE. */
import * as Store from "../store.mjs";
import { tacticsApi as Api } from "../api.mjs";
import { t, errText } from "../lang.mjs";

const open = new Map();          // prompt id -> dialog
const esc = (s) => { try { return foundry.utils.escapeHTML(String(s)); } catch { return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])); } };
const nameOf = (combat, id) => combat?.combatants?.get(id)?.name ?? t("ITAC.Someone");
const warn = (env) => { if (env && env.ok === false && env.error?.code !== "gone") { try { ui.notifications.warn(errText(env.error), { console: false }); } catch { /* no ui */ } } };

function dialog({ title, content, buttons, onClose }) {
  const { DialogV2 } = foundry.applications.api;
  const dlg = new DialogV2({ window: { title, icon: "fa-solid fa-layer-group" }, classes: ["itn-dialog", "itac-dialog"], position: { width: 380 }, content, buttons, modal: false, rejectClose: false, submit: () => {} });
  dlg.addEventListener("close", () => { try { onClose?.(); } catch { /* ignore */ } }, { once: true });
  dlg.render({ force: true });
  return dlg;
}

function build(combat, p) {
  const about = p.about ? nameOf(combat, p.about) : "";
  const body = (text) => `<p class="itn-body">${esc(text)}</p>`;
  const answer = (value) => () => { Api.answer(p.id, value, combat).then(warn); };
  switch (p.kind) {
    case "veteran": {
      const card = p.data?.card ?? "?";
      return { title: t("ITAC.Prompt.veteran.Title"), content: body(t("ITAC.Prompt.veteran.Body", { name: about, card })),
        buttons: [{ action: "keep", label: t("ITAC.Prompt.veteran.keep", { card }), callback: answer("keep") }, { action: "draw", label: t("ITAC.Prompt.veteran.draw"), default: true, callback: answer("draw") }] };
    }
    case "reflexes":
      return { title: t("ITAC.Prompt.reflexes.Title"), content: body(t("ITAC.Prompt.reflexes.Body", { name: about })),
        buttons: p.options.map((o, i) => ({ action: `c${o.id}`, label: t("ITAC.Prompt.reflexes.card", { card: o.id }), default: i === 0, callback: answer(o.id) })) };
    case "grantConsent":
      return { title: t("ITAC.Prompt.grantConsent.Title"), content: body(t("ITAC.Prompt.grantConsent.Body", { name: about, from: p.data?.from ? nameOf(combat, p.data.from) : t("ITAC.Someone") })),
        buttons: [{ action: "yes", label: t("ITAC.Prompt.grantConsent.yes"), default: true, callback: answer("yes") }, { action: "no", label: t("ITAC.Prompt.grantConsent.no"), callback: answer("no") }] };
    case "challengeFail":
      return { title: t("ITAC.Prompt.challengeFail.Title"), content: body(t("ITAC.Prompt.challengeFail.Body", { name: about })),
        buttons: [{ action: "run", label: t("ITAC.Prompt.challengeFail.run"), default: true, callback: answer("run") }] };
    case "triggerQueue": {
      const at = ["roundStart", "roundEnd", "turnStart", "turnEnd"].includes(p.data?.at) ? p.data.at : "roundStart";
      const rows = p.options.map((o) => `<label class="itn-never"><input type="checkbox" name="run" value="${esc(o.id)}" checked><span>${esc(o.label)}</span></label>`).join("");
      return { title: t(`ITAC.Prompt.triggerQueue.Title.${at}`, { round: Store.stateOf(combat)?.round ?? "", name: about }), content: body(t("ITAC.Prompt.triggerQueue.Body")) + rows,
        buttons: [{ action: "go", label: t("ITAC.Prompt.triggerQueue.Go"), default: true, callback: (_ev, btn) => {
          const skip = [...(btn.form?.querySelectorAll?.('input[name="run"]') ?? [])].filter((i) => !i.checked).map((i) => i.value);
          Api.answer(p.id, { order: [], skip }, combat).then(warn);
        } }] };
    }
    default: return null;                    // a prompt of another package: not ours to show
  }
}

/** Show a dialog for every open prompt this user is asked to answer, close the ones whose prompt is gone. */
export function sync() {
  try {
    const combat = Store.currentCombat();
    const list = combat ? Api.prompts(combat) : [];
    const live = new Set(list.map((p) => p.id));
    for (const [id, dlg] of open) if (!live.has(id)) { open.delete(id); try { dlg.close(); } catch { /* already closed */ } }
    for (const p of list) {
      if (open.has(p.id)) continue;
      const spec = build(combat, p);
      if (!spec) continue;
      open.set(p.id, dialog({ ...spec, onClose: () => { if (open.get(p.id)) open.delete(p.id); } }));
    }
  } catch (e) { console.warn(`${Store.MOD} | tactics prompts`, e); }
}
/** a dialog closed without an answer comes back with this (the prompt is still open in the state) */
export const reopen = () => sync();

/** The end-of-scene confirmation (spec 6.8) for the executor: -> "done" | "skip" | "cancel". */
export function sceneEnd(combat) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const lines = Api.scenePlan(combat);
      const rows = lines.length
        ? lines.map((l) => `<label class="itn-never"><input type="checkbox" name="line" value="${esc(l.id)}" checked><span>${esc(l.resolve.from !== l.resolve.to
          ? t("ITAC.Scene.LineResolve", { name: l.name, from: l.health.from, to: l.health.to, rfrom: l.resolve.from, rto: l.resolve.to })
          : t("ITAC.Scene.Line", { name: l.name, from: l.health.from, to: l.health.to }))}</span></label>`).join("")
        : `<p class="itn-body">${esc(t("ITAC.Scene.None"))}</p>`;
      dialog({
        title: t("ITAC.Scene.Title"), content: `<p class="itn-body">${esc(t("ITAC.Scene.Body"))}</p>${rows}`, onClose: () => finish("cancel"),
        buttons: [
          { action: "apply", label: t("ITAC.Scene.Apply"), default: true, callback: async (_ev, btn) => {
            const skip = [...(btn.form?.querySelectorAll?.('input[name="line"]') ?? [])].filter((i) => !i.checked).map((i) => i.value);
            const env = await Api.endScene({ skip }, combat); warn(env); finish(env?.ok === false ? "cancel" : "done");
          } },
          { action: "skip", label: t("ITAC.Scene.Skip"), callback: () => finish("skip") },
          { action: "cancel", label: t("ITAC.Scene.Cancel"), callback: () => finish("cancel") }
        ]
      });
    } catch (e) { console.warn(`${Store.MOD} | tactics scene end dialog`, e); finish("skip"); }
  });
}
