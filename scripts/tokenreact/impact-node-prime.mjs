/* For node checks only: import this file (for its effect) before driving the token reactions without a running engine. It hands the vendored
   engine's public impact table to pure.mjs, as main.mjs does on a page with the running engine's L.impact (useImpactTable). Runtime code
   never imports it. */
import * as P from "./pure.mjs";
import { impactApi } from "./impact-node.mjs";
P.useImpactTable(impactApi());
