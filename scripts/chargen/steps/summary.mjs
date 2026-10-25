/* Readable summary rows of the wizard state, per step. Used by the placeholder steps (until phases 5a-5f replace them) and by the Review step.
   Pure: state in, rows [{label, value, empty}] out. Strings via lang.mjs. */
import { t } from "../lang.mjs";
import { RANKS, ATTRS, attributeBudget, slots } from "../rules.mjs";
import { attrLabel, rankName, levelName } from "./util.mjs";

const row = (label, value) => {
  const v = Array.isArray(value) ? value.filter(Boolean).join(", ") : String(value ?? "").trim();
  return { label, value: v, empty: !v };
};
const named = (x) => x?.name ?? "";
const textOf = (x) => (x ? (x.text ? `${x.name}. ${x.text}` : x.name) : "");

export function summaryRows(step, s) {
  switch (step) {
    case "start":
      return [row(t("IPC.Summary.Mode"), t(`IPC.Mode.${s.mode === "random" ? "random" : "manual"}`)), row(t("IPC.Summary.Seed"), s.seed)];
    case "rank": {
      const r = RANKS[s.rank];
      return [row(t("IPC.Summary.Rank"), rankName(s.rank)),
        row(t("IPC.Summary.RankNumbers"), r ? t("IPC.Rank.Numbers", { points: r.points, cap: r.cap, powers: r.powers, rep: r.reputation }) : "")];
    }
    case "concept":
      return [row(t("IPC.Summary.Archetype"), s.archetype ?? t("IPC.Summary.Scratch")), row(t("IPC.Summary.Role"), s.role),
        row(t("IPC.Summary.Identity"), s.identity ? t(`IPC.Identity.${s.identity}`) : "")];
    case "powers": {
      const multi = (s.sources ?? []).length > 1;
      const src = (key) => (multi ? (s.sources.find((x) => x.key === key)?.name ?? "") : "");
      return [row(t("IPC.Summary.Powers"), (s.powers ?? []).map((p) => {
        const bits = [p.level > 0 ? levelName(p.level) : "", p.boosts?.length ? t("IPC.Summary.Boosts", { n: p.boosts.length }) : "", p.limits?.length ? t("IPC.Summary.Limits", { n: p.limits.length }) : "", src(p.sourceKey)].filter(Boolean);
        return bits.length ? `${p.name} (${bits.join(", ")})` : p.name;
      })), row(t("IPC.Summary.Sources"), (s.sources ?? []).map(named))];
    }
    case "talents":
      return [row(t("IPC.Summary.HeroTalent"), named(s.heroTalent)), row(t("IPC.Summary.OccTalent"), named(s.occTalent)),
        row(t("IPC.Summary.ExtraTalents"), (s.extraTalents ?? []).map(named)),
        row(t("IPC.Summary.Drawbacks"), (s.drawbacks ?? []).map((d) => (d.note ? `${d.name} (${d.note})` : d.name)))];
    case "attributes": {
      const b = attributeBudget(s);
      return [...ATTRS.map((k) => row(attrLabel(k), String(s.attrs?.[k] ?? 0))),
        row(t("IPC.Summary.Budget"), t("IPC.Summary.BudgetValue", { spent: b.spent, budget: b.budget, slots: slots(s), cap: b.cap }))];
    }
    case "life":
      return [row(t("IPC.Summary.Occupation"), s.occupation), row(t("IPC.Summary.Resources"), s.occupation ? String(s.resources ?? 0) : ""),
        row(t("IPC.Summary.NpcRel"), [s.npcRel?.name, s.npcRel?.type ? `(${s.npcRel.type})` : ""])];
    case "persona":
      return [row(t("IPC.Summary.HeroName"), s.heroName), row(t("IPC.Summary.CivilianName"), s.civilianName),
        row(t("IPC.Summary.Personality"), s.personality ?? []), row(t("IPC.Summary.Drive"), textOf(s.drive)),
        row(t("IPC.Summary.Flaw"), textOf(s.flaw)), row(t("IPC.Summary.Appearance"), s.appearance)];
    case "team":
    {
      const tm = s.team ?? {}, mode = tm.mode ?? "text";
      const card = mode === "join" || mode === "member" ? globalThis.game?.actors?.get?.(tm.baseId) : null;   // phase 5f: the card's own name stands in for the typed one
      return [row(t("IPC.Summary.TeamMode"), t(`IPC.Summary.Mode.${mode}`)),
        row(t("IPC.Summary.TeamName"), card?.name ?? tm.name), row(t("IPC.Summary.TeamBase"), mode === "join" || mode === "member" ? "" : [tm.base, tm.where]),
        row(t("IPC.Summary.Upgrades"), tm.upgrades ?? []), row(t("IPC.Summary.HeroRel"), s.heroRel?.name)];
    }
    default:
      return [];
  }
}
