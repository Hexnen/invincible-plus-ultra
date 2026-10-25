/* Activity log UI: the MAINTENANCE pane of the Table log (GM only). Plain DOM. Three sections: Health (numbers about the logs and the scribe), Limits (retention
   overrides for heroes and bases) and Logs (one row per log with an inline "Manage" row: open, export, import, trim, delete). It repaints itself when logs change
   (debounced). Every destructive action goes through ui/maint-dialogs.mjs and the staff-only functions of maint.mjs; this file never writes by itself. */
import * as E from "../events.mjs";
import * as MP from "../maint-pure.mjs";
import * as Maint from "../maint.mjs";
import * as Store from "../store.mjs";
import * as R from "./rows.mjs";
import { t, tn } from "../lang.mjs";
import { h, icon, sr, uid } from "./dom.mjs";

const MOD = E.MOD_ID;
const sizeLabel = (b) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const ago = (ms) => (ms ? new Intl.DateTimeFormat(R.langTag(), { dateStyle: "medium", timeStyle: "short" }).format(ms) : t("IPL.Maint.TNever"));
const offsetMin = () => -new Date().getTimezoneOffset();

export function saveFile(res) { foundry.utils.saveDataToFile(res.text, res.mime, res.filename); ui.notifications?.info(t("IPL.UI.Exported", { file: res.filename }), { console: false }); }

export class MaintView {
  #unsub = null; #timer = 0; #hooks = []; #busy = false;
  constructor(opts = {}) {
    this.o = opts; this.id = uid("iplm");
    this.open = new Set();            // log ids whose manage row is open
    this.el = h("div.ipl.ipl-maint", { "aria-label": t("IPL.Table.TabMaint") });
    this.el.addEventListener("click", (ev) => this.#click(ev));
    this.$live = h("p.ipl-sr", { role: "status", "aria-live": "polite" });
    this.#unsub = Store.subscribe(() => this.#later());
    for (const hk of ["userConnected", "updateUser", "updateSetting", `${MOD}.scribe`, `${MOD}.logQueue`, "createActor", "deleteActor"]) { const fn = () => this.#later(); Hooks.on(hk, fn); this.#hooks.push([hk, fn]); }
    this.paint();
  }
  destroy() { this.#unsub?.(); clearTimeout(this.#timer); for (const [hk, fn] of this.#hooks) Hooks.off(hk, fn); this.#hooks = []; this.el.remove(); }
  #later() { clearTimeout(this.#timer); this.#timer = setTimeout(() => { if (this.el.isConnected && !this.#busy && !this.el.contains(document.activeElement?.closest?.("input"))) this.paint(); }, 500); }
  #say(text) { this.$live.textContent = ""; setTimeout(() => { this.$live.textContent = text; }, 30); }

  paint() {
    let hl, rows;
    try { hl = Maint.health(); rows = Maint.logs(); } catch (e) { this.el.replaceChildren(h("p.ipl-state-h", { style: "padding:16px" }, t("IPL.Maint.NotAllowed"))); return; }
    const focusKey = document.activeElement?.closest?.("[data-key]")?.dataset.key ?? null;
    const scroller = this.el.parentElement, top = scroller?.scrollTop ?? 0;
    this.el.replaceChildren(this.#health(hl), this.#limits(hl), this.#logs(rows), this.$live);
    if (scroller) scroller.scrollTop = top;
    if (focusKey) this.el.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  /* ---------------------------------------------------------------- health */
  #health(hl) {
    const T = hl.totals, S = hl.scribe, sess = hl.session;
    const fact = (label, value, hint, show, cls) => h("div.ipl-fact", { title: hint ?? null, class: cls ?? null }, h("dt", label), h("dd", { class: value === "0" ? "ipl-zero" : null }, value, hint && (show ? h("small", hint) : h("small.ipl-sr", hint))));   // hints of the quiet facts: tooltip + screen reader text
    const scribe = !S.activeGm ? t("IPL.Maint.HScribeNone") : S.thisClient ? t("IPL.Maint.HScribeMe", { name: S.activeGm }) : t("IPL.Maint.HScribeOther", { name: S.activeGm });
    const q = hl.queue;
    const state = (txt, bad) => h("span.ipl-hs", { class: bad ? "ipl-bad" : "ipl-good" }, icon(bad ? "fa-triangle-exclamation" : "fa-circle-check"), h("span", txt));
    return h("section.ipl-msec", { "aria-labelledby": `${this.id}-h` },
      h("h2.ipl-mh", { id: `${this.id}-h` }, t("IPL.Maint.Health")),
      h("dl.ipl-health",
        fact(t("IPL.Maint.HLogging"), state(hl.enabled ? t("IPL.Maint.HOn") : t("IPL.Maint.HOff"), !hl.enabled)),
        fact(t("IPL.Maint.HScribe"), state(scribe, !S.activeGm), t("IPL.Maint.HScribeHint"), true),
        fact(t("IPL.Maint.HRead"), t(`IPL.Settings.logReadAccess.${hl.readAccess}`)),
        fact(t("IPL.Maint.HStored"), t("IPL.Maint.HStoredV", { logs: tn("IPL.Plural.Logs", T.logs), entries: tn("IPL.Plural.Entries", T.entries + T.secret), size: sizeLabel(T.bytes) })),
        fact(t("IPL.Maint.HNear"), T.near ? state(t("IPL.Maint.HNearV", { n: T.near, total: T.logs }), true) : t("IPL.Maint.HNone"))),
      // L9: the counters are a quiet second list (label left, number right, zeros muted); only status and problems are big
      h("dl.ipl-health.ipl-health-q",
        fact(t("IPL.Maint.HGaps"), String(T.gaps), t("IPL.Maint.HGapsHint")),
        fact(t("IPL.Maint.HThrottle"), String(T.throttles), t("IPL.Maint.HThrottleHint")),
        fact(t("IPL.Maint.HUnverified"), String(T.unverified), t("IPL.Maint.HUnverifiedHint")),
        fact(t("IPL.Maint.HImported"), String(T.imported)),
        fact(t("IPL.Maint.HPruned"), String(T.pruned)),
        fact(t("IPL.Maint.HNotLogged"), String(hl.notLogged), t("IPL.Maint.HNotLoggedHint")),
        fact(t("IPL.Maint.HSession"), t("IPL.Maint.HSessionV", { batches: sess.batches, failed: sess.failures + sess.writeFailures, dropped: sess.dropped, waiting: sess.pending }), null, false, "ipl-fact-wide"),
        fact(t("IPL.Maint.HQueue"), q.n ? t("IPL.Maint.HQueueV", { n: q.n }) : t("IPL.Maint.HQueueEmpty"), t("IPL.Maint.HQueueHint"), true, "ipl-fact-wide")
      ));
  }

  /* ---------------------------------------------------------------- limits */
  #limits(hl) {
    const id = this.id;
    const hero = h("input.ipl-input", { id: `${id}-rh`, name: "hero", type: "number", min: "0", max: String(MP.LIMITS.retainMax), step: "1", inputmode: "numeric", value: String(hl.retention.hero), "data-key": "rh" });
    const auto = hl.retention.baseOverride === null;
    const base = h("input.ipl-input", { id: `${id}-rb`, name: "base", type: "number", min: "0", max: String(MP.LIMITS.retainMax), step: "1", inputmode: "numeric", value: String(hl.retention.base), disabled: auto, "data-key": "rb" });
    const autoBox = h("input", { id: `${id}-ra`, type: "checkbox", checked: auto, "data-key": "ra" });
    autoBox.addEventListener("change", () => { base.disabled = autoBox.checked; });
    const err = h("p.ipl-err-t", { role: "alert", hidden: true });
    const form = h("form.ipl-limits", { novalidate: true },
      h("div.ipl-field", h("label", { for: hero.id }, t("IPL.Maint.RHero")), hero),
      h("div.ipl-field", h("label", { for: base.id }, t("IPL.Maint.RBase")), base,
        h("label.ipl-check", autoBox, h("span", t("IPL.Maint.RAuto", { n: MP.parseRetention(hl.retention.hero) === 0 ? 0 : Math.round(hl.retention.hero * 0.6) })))),
      h("div.ipl-limits-go", h("button.ipl-btn", { type: "submit" }, icon("fa-floppy-disk"), h("span", t("IPL.Maint.RSave"))), err));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const hv = MP.parseRetention(hero.value), bv = autoBox.checked ? null : MP.parseRetention(base.value);
      if (hv === null || (!autoBox.checked && bv === null)) { err.textContent = t("IPL.Maint.RBad"); err.hidden = false; return; }
      err.hidden = true;
      try { await Maint.setRetention({ hero: hv, base: bv }); this.#say(t("IPL.Maint.RSaved")); ui.notifications?.info(t("IPL.Maint.RSaved"), { console: false }); this.paint(); }
      catch (e) { err.textContent = t("IPL.Maint.Failed", { why: t(`IPL.UI.Err.${e?.code ?? "badInput"}`) }); err.hidden = false; }
    });
    return h("section.ipl-msec", { "aria-labelledby": `${id}-l` }, h("h2.ipl-mh", { id: `${id}-l` }, t("IPL.Maint.Limits")), form, h("p.ipl-hint.ipl-limits-hint", t("IPL.Maint.RHint")));
  }

  /* ---------------------------------------------------------------- logs */
  #logs(rows) {
    const id = this.id;
    const head = h("div.ipl-mbar",
      h("h2.ipl-mh", { id: `${id}-t` }, t("IPL.Maint.Logs")),
      h("div.ipl-mbtns",
        h("button.ipl-btn", { type: "button", "data-ipl-act": "m-archive", title: t("IPL.Maint.ExportArchiveTip"), "data-key": "arch" }, icon("fa-box-archive"), h("span", t("IPL.Maint.ExportArchive"))),
        h("button.ipl-btn", { type: "button", "data-ipl-act": "m-import", "data-key": "imp" }, icon("fa-file-import"), h("span", t("IPL.Maint.ImportFile")))));
    if (!rows.length) return h("section.ipl-msec", { "aria-labelledby": `${id}-t` }, head, h("p.ipl-state-b", t("IPL.Maint.NoLogs")));
    const table = h("table.ipl-mtable", h("caption.ipl-sr", t("IPL.Maint.TAria")),
      h("thead", h("tr", ["TName", "TEntries", "TSize", "TLast", "TNotes", "TActions"].map((k) => h("th", { scope: "col" }, t(`IPL.Maint.${k}`))))));
    const body = h("tbody");
    for (const r of rows) body.append(...this.#row(r));
    table.append(body);
    return h("section.ipl-msec", { "aria-labelledby": `${id}-t` }, head, h("div.ipl-mscroll", table));
  }
  #row(r) {
    const kind = r.orphan ? "IPL.Table.ScopeOrphan" : r.scope === "base" ? "IPL.Table.ScopeBase" : "IPL.Table.ScopeHero";
    const open = this.open.has(r.actorId), pid = `${this.id}-m-${r.actorId}`;
    const pct = r.cap ? Math.min(100, Math.round((r.count / r.cap) * 100)) : 0;
    const flags = [];
    const S = r.summary;
    if (S.gaps) flags.push(h("span.ipl-chip.ipl-approx", icon("fa-triangle-exclamation"), h("span", t("IPL.Maint.Gaps", { n: S.gaps }))));
    if (S.throttles) flags.push(h("span.ipl-chip", icon("fa-gauge-high"), h("span", t("IPL.Maint.Throttled", { n: S.throttles }))));
    if (S.unverified) flags.push(h("span.ipl-chip.ipl-approx", icon("fa-user-clock"), h("span", t("IPL.Maint.Late", { n: S.unverified }))));
    if (S.importedEntries) flags.push(h("span.ipl-chip.ipl-imp", icon("fa-file-import"), h("span", t("IPL.Maint.ImportedN", { n: S.importedEntries }))));
    const tr = h("tr.ipl-mrow", { "data-id": r.actorId, "data-usage": r.usage.state },
      h("th", { scope: "row", "data-label": t("IPL.Maint.TName") }, h("span.ipl-mname", r.name), h("span.ipl-mkind", icon(r.orphan ? "fa-ghost" : r.scope === "base" ? "fa-people-roof" : "fa-mask"), h("span", t(kind)))),
      h("td", { "data-label": t("IPL.Maint.TEntries") },
        h("span.ipl-mcount", r.cap ? t("IPL.Maint.TUsage", { count: r.count, cap: r.cap }) : t("IPL.Maint.TNoCap", { count: r.count })),
        r.cap ? h("span.ipl-meter", { "aria-hidden": "true" }, h("i", { style: `width:${pct}%` })) : null,
        h("span.ipl-mstate", { class: `ipl-st-${r.usage.state}` }, t(`IPL.Maint.State.${r.usage.state}`) + (r.secretCount ? ` · ${t("IPL.Maint.TSecret", { n: r.secretCount })}` : ""))),
      h("td", { "data-label": t("IPL.Maint.TSize") }, sizeLabel(r.bytes), h("small", tn("IPL.Plural.Chunks", r.chunks))),
      h("td", { "data-label": t("IPL.Maint.TLast") }, h("time", { datetime: r.last ? new Date(r.last).toISOString() : null }, ago(r.last))),
      h("td", { "data-label": t("IPL.Maint.TNotes") }, h("div.ipl-flags", flags)),
      h("td.ipl-macts", { "data-label": t("IPL.Maint.TActions") },
        h("button.ipl-btn.ipl-sm", { type: "button", "data-ipl-act": "m-show", "data-ipl-id": r.actorId, "data-key": `show-${r.actorId}` }, icon("fa-timeline"), h("span", t("IPL.Table.TabTimeline"))),
        h("button.ipl-btn.ipl-sm", { type: "button", "data-ipl-act": "m-manage", "data-ipl-id": r.actorId, "aria-expanded": String(open), "aria-controls": pid, "aria-label": t("IPL.Maint.ManageAria", { name: r.name }), "data-key": `man-${r.actorId}` }, icon("fa-ellipsis"), h("span", t("IPL.Maint.Manage")))));
    const mk = (act, ic, label, extra = "") => h("button.ipl-btn.ipl-sm" + extra, { type: "button", "data-ipl-act": act, "data-ipl-id": r.actorId, "data-key": `${act}-${r.actorId}` }, icon(ic), h("span", label));
    const acts = h("tr.ipl-mmanage", { id: pid, hidden: !open },
      h("td", { colspan: "6" }, h("div.ipl-mactions", { role: "group", "aria-label": t("IPL.Maint.ManageAria", { name: r.name }) },
        r.actor ? mk("m-sheet", "fa-up-right-from-square", t("IPL.Maint.Open")) : null,
        ["json", "csv", "md"].map((f) => h("button.ipl-btn.ipl-sm", { type: "button", "data-ipl-act": "m-export", "data-ipl-id": r.actorId, "data-ipl-fmt": f, "data-key": `exp${f}-${r.actorId}` }, icon("fa-file-arrow-down"), h("span", t("IPL.Maint.ExportAs", { format: f === "md" ? "Markdown" : f.toUpperCase() })))),
        mk("m-import-into", "fa-file-import", t("IPL.Maint.ImportInto")),
        mk("m-trim", "fa-scissors", t("IPL.Maint.Trim")),
        mk("m-delete", "fa-trash", t("IPL.Maint.Delete"), ".ipl-danger"))));
    return [tr, acts];
  }

  /* ---------------------------------------------------------------- actions */
  async #click(ev) {
    const b = ev.target.closest?.("[data-ipl-act]");
    if (!b || !this.el.contains(b) || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    const act = b.dataset.iplAct, id = b.dataset.iplId;
    const row = () => Maint.logs().find((x) => x.actorId === id);
    try {
      switch (act) {
        case "m-manage": {
          const was = this.open.has(id); was ? this.open.delete(id) : this.open.add(id);
          b.setAttribute("aria-expanded", String(!was));
          const panel = this.el.querySelector(`#${CSS.escape(b.getAttribute("aria-controls"))}`); if (panel) panel.hidden = was;
          break;
        }
        case "m-show": this.o.onShow?.(id); break;
        case "m-sheet": game.actors.get(id)?.sheet?.render(true); break;
        case "m-export": {
          const res = Maint.exportLog(id, b.dataset.iplFmt, { text: (e) => R.sentenceText(e, this.#ctx(id), { kid: true }), labels: { gmOnly: t("IPL.UI.GmOnly") }, offsetMin: offsetMin() });
          saveFile(res); break;
        }
        case "m-archive": saveFile(Maint.exportBundle()); break;
        case "m-import": case "m-import-into": {
          const { importDialog } = await import("./maint-dialogs.mjs");
          const r = act === "m-import-into" ? row() : null;
          const out = await importDialog(r ? r.actorId : null, r?.name ?? "");
          if (!out) break;
          this.#busy = true;
          const res = await Maint.importLog(out.text, { target: r ? r.actorId : null, fileName: out.fileName });
          ui.notifications?.info(t("IPL.Imp.Done", { entries: tn("IPL.Plural.Entries", res.written), logs: tn("IPL.Plural.Logs", res.logs.filter((x) => x.n).length) }), { console: false });
          this.#say(t("IPL.Imp.Done", { entries: tn("IPL.Plural.Entries", res.written), logs: tn("IPL.Plural.Logs", res.logs.filter((x) => x.n).length) }));
          break;
        }
        case "m-trim": {
          const { trimDialog } = await import("./maint-dialogs.mjs");
          const r = row(); if (!r) break;
          const out = await trimDialog(r, saveFile); if (!out) break;
          this.#busy = true;
          const res = await Maint.trim(id, { keep: out.keep });
          const msg = res ? t("IPL.Trim.Done", { removed: tn("IPL.Plural.Entries", res.removed), remain: tn("IPL.Plural.Entries", res.remain) }) : t("IPL.Trim.Nothing");
          ui.notifications?.info(msg, { console: false }); this.#say(msg);
          break;
        }
        case "m-delete": {
          const { deleteDialog } = await import("./maint-dialogs.mjs");
          const r = row(); if (!r) break;
          const out = await deleteDialog(r, saveFile); if (!out) break;
          this.#busy = true;
          await Maint.remove(id);
          this.open.delete(id);
          ui.notifications?.info(t("IPL.Del.Done"), { console: false }); this.#say(t("IPL.Del.Done"));
          break;
        }
        default: break;
      }
    } catch (e) {
      console.warn(`${MOD} | log maintenance failed`, e);
      ui.notifications?.error(t("IPL.Maint.Failed", { why: t(`IPL.UI.Err.${e?.code ?? "badInput"}`) }));
    } finally { this.#busy = false; if (act !== "m-manage" && act !== "m-show") this.paint(); }
  }
  /** Minimal row context for localized export prose. */
  #ctx(id) {
    const l = Store.listLogJournals().find((x) => x.actorId === id);
    return { scope: l?.scope ?? "hero", userName: (u) => (u ? (game.users.get(u)?.name ?? t("IPL.UI.UnknownUser")) : t("IPL.UI.System")), actor: () => game.actors.get(id) ?? null, notesOn: new Map(), isGM: true };
  }
}
