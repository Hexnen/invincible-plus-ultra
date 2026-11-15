/* For node checks only (no Foundry, no running engine): the vendored engine's public impact table, as L.impact hands it out on a page
   (scripts/letters/impact/index.mjs api: steps, series, tiers, tierOf, stepOf, seriesBoost). Runtime code never imports this file: it reads
   the running engine (L.impact). */
import { STEP_AT, SERIES_STEP, SERIES_MAX, TIER_AT, tierOf, stepOf, seriesBoost } from "../letters/impact/plan.mjs";
export const impactApi = () => ({ steps: STEP_AT.slice(), series: { step: SERIES_STEP, max: SERIES_MAX }, tiers: TIER_AT.slice(), tierOf, stepOf, seriesBoost });
