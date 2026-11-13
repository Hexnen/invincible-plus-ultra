/* LETR: hands the shared comic lettering engine (scripts/letters/, a vendored copy of moinen-maps' scripts/letters/) to macros and
   to this module's own code:
     await game.modules.get("invincible-plus-ultra").api.letters()   -> the engine (see scripts/letters/README.md)
   Module code imports it directly:  import { letters } from "../letters/index.mjs";  const L = await letters();
   When moinen-maps is active too, both modules share ONE engine instance (the newest copy's): globalThis.MoinenLetters.engine(). */
import { letters } from "./letters/index.mjs";

Hooks.once("ready", () => {
  setTimeout(() => {   // after the module's own ready handlers, which rebuild mod.api with a spread
    const mod = game.modules.get("invincible-plus-ultra");
    if ( mod ) mod.api = Object.assign(mod.api ?? {}, { letters });
  }, 0);
});
