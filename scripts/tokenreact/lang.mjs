/* Token reactions strings (ITR.*), embedded like scripts/tokenhalo/lang.mjs (Foundry reads a module's language list only when the server
   starts). Flat keys, English underneath, Polish on top. Settings names carry a "Token reactions: " prefix because they share the Plus
   Ultra settings list. Parity check: node scripts/tokenreact/check-lang.mjs */
export const EN = {
  "ITR.Settings.Enabled.Name": "Token reactions: enabled",
  "ITR.Settings.Enabled.Hint": "When a character's Health or Resolve changes, its token answers on the map with a comic sound word and the number: a hit, a heavy hit, going down, healing, stress, Resolve spent or regained. Only what the table was shown: nothing over hidden tokens, no secret numbers. In a tactical fight it takes the place of the plain numbers over tokens. This client only.",
  "ITR.Settings.Size.Name": "Token reactions: size",
  "ITR.Settings.Size.Hint": "How big the lettering is next to the token (it stays the same size against the map at any zoom).",
  "ITR.Settings.Size.small": "Small",
  "ITR.Settings.Size.normal": "Normal",
  "ITR.Settings.Size.large": "Large",
  "ITR.Settings.Layer.Name": "Token reactions: layer",
  "ITR.Settings.Layer.Hint": "Where the lettering is drawn on the map. Over the whole scene it is always readable and may cover a token for a moment; on the ground the tokens stay on top and the word shows around them.",
  "ITR.Settings.Layer.overlay": "Over the whole scene and its lighting",
  "ITR.Settings.Layer.weather": "Over weather and smoke (in the scene's light)",
  "ITR.Settings.Layer.tokens": "Over tokens (under smoke and weather)",
  "ITR.Settings.Layer.ground": "On the ground (under tokens)",
  "ITR.Settings.Layer.top": "Over everything on the canvas"
};

export const PL = {
  "ITR.Settings.Enabled.Name": "Reakcje żetonów: włączone",
  "ITR.Settings.Enabled.Hint": "Gdy zmienia się Zdrowie albo Determinacja postaci, jej żeton odpowiada na mapie komiksowym dźwiękiem i liczbą: trafienie, mocne trafienie, upadek, leczenie, stres, Determinacja wydana albo odzyskana. Tylko to, co stół widział: nic nad ukrytymi żetonami, żadnych tajnych liczb. W walce taktycznej zastępuje zwykłe liczby nad żetonami. Tylko ten klient.",
  "ITR.Settings.Size.Name": "Reakcje żetonów: wielkość",
  "ITR.Settings.Size.Hint": "Jak duży jest napis przy żetonie (względem mapy zawsze taki sam, przy każdym przybliżeniu).",
  "ITR.Settings.Size.small": "Mały",
  "ITR.Settings.Size.normal": "Zwykły",
  "ITR.Settings.Size.large": "Duży",
  "ITR.Settings.Layer.Name": "Reakcje żetonów: warstwa",
  "ITR.Settings.Layer.Hint": "Gdzie na mapie rysuje się napis. Nad całą sceną jest zawsze czytelny i może na chwilę zasłonić żeton; na ziemi żetony zostają na wierzchu, a napis widać wokół nich.",
  "ITR.Settings.Layer.overlay": "Nad całą sceną i oświetleniem",
  "ITR.Settings.Layer.weather": "Nad pogodą i dymem (w świetle sceny)",
  "ITR.Settings.Layer.tokens": "Nad żetonami (pod dymem i pogodą)",
  "ITR.Settings.Layer.ground": "Na ziemi (pod żetonami)",
  "ITR.Settings.Layer.top": "Nad wszystkim na płótnie"
};

export function t(key) {
  let lang = "en";
  try { lang = globalThis.game?.i18n?.lang ?? "en"; } catch { lang = "en"; }
  return (lang === "pl" ? PL[key] : undefined) ?? EN[key] ?? key;
}
