import { readFileSync } from "node:fs";
import * as S from "../chargen/state.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };

// S022: per-attribute locks survive serialize / deserialize
const st = S.createState({ seed: "123456" });
st.locks = { "attrs.fighting": true, "attrs.presence": true, "attrs.bogus": true, powers: true, nonsense: true };
const back = S.deserialize(S.serialize(st));
ok(back.locks["attrs.fighting"] === true && back.locks["attrs.presence"] === true, "S022: attrs.<name> locks kept");
ok(back.locks.powers === true, "S022: step lock kept");
ok(!("attrs.bogus" in back.locks) && !("nonsense" in back.locks), "S022: unknown lock keys still dropped");

// S023: board commits rebase on the current state (DOM code: source assertions + rebase logic)
const src = readFileSync(new URL("../chargen/steps/board.mjs", import.meta.url), "utf8");
ok(/import \{ STEP_FIELDS, rebase \} from "\.\.\/state\.mjs"/.test(src), "S023: rebase imported");
ok(/if \(base\) next = rebase\(ctx\.state, base, next\)/.test(src), "S023: show rebases");
ok((src.match(/show\(ctx, [^\n]*base: (s|start)/g) || []).length === 4, "S023: reroll, rerollAll, reseedTo, rank pass their base");
const a = S.createState({ seed: "123456" });
const rolledPowers = S.patch(a, { powers: [{ name: "X" }] });
const cur = S.patch(a, { heroName: "Persona" });   // second roll committed meanwhile
const merged = S.rebase(cur, a, rolledPowers);
ok(merged.heroName === "Persona" && merged.powers.length === 1, "S023: late commit keeps the earlier change");
console.log(`sweep c6: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
