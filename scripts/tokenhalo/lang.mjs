/* Token halo strings (ITH.*), embedded because Foundry reads a module's language list only when the server starts. t() reads these tables
   directly (no game.i18n merge), same as scripts/combat/lang.mjs. Flat keys, English underneath, Polish on top. Settings names carry a
   "Token halo: " prefix because they share the Plus Ultra settings list. Parity check: node scripts/tokenhalo/check-lang.mjs */
export const EN = {
  "ITH.Settings.Enabled.Name": "Token halo: enabled",
  "ITH.Settings.Enabled.Hint": "A ring of comic halftone dots under a token while you hover it, select it, or when it is the active combatant. This client only.",
  "ITH.Settings.Hover.Name": "Token halo: on hover",
  "ITH.Settings.Hover.Hint": "Show the halo while the pointer is over a token.",
  "ITH.Settings.Selected.Name": "Token halo: when selected",
  "ITH.Settings.Selected.Hint": "Show the halo under every token you have selected.",
  "ITH.Settings.Turn.Name": "Token halo: active turn",
  "ITH.Settings.Turn.Hint": "A stronger yellow halo with an outer ring of bigger dots under the token whose turn it is in combat.",
  "ITH.Settings.Size.Name": "Token halo: size",
  "ITH.Settings.Size.Hint": "How far the ring reaches around the token.",
  "ITH.Settings.Size.small": "Small",
  "ITH.Settings.Size.normal": "Normal",
  "ITH.Settings.Size.large": "Large",
  "ITH.Settings.Motion.Name": "Token halo: motion",
  "ITH.Settings.Motion.Hint": "Calm: the rings appear softly and only the active-turn ring breathes slowly. Lively: every ring breathes and some dots flicker. Off: nothing moves. Also off when your system asks for reduced motion or Foundry runs in low performance mode.",
  "ITH.Settings.Motion.off": "Off",
  "ITH.Settings.Motion.calm": "Calm",
  "ITH.Settings.Motion.lively": "Lively",
  "ITH.Settings.HideBorder.Name": "Token halo: hide Foundry's token border",
  "ITH.Settings.HideBorder.Hint": "While the halo is shown, hide the default border Foundry draws on hover and selection. It comes back when the halo goes away.",
  "ITH.Settings.HideMarker.Name": "Token halo: hide Foundry's turn marker",
  "ITH.Settings.HideMarker.Hint": "While the active-turn halo is shown, hide Foundry's own turn marker ring. It comes back when the halo goes away."
};

export const PL = {
  "ITH.Settings.Enabled.Name": "Aura tokenu: włączona",
  "ITH.Settings.Enabled.Hint": "Pierścień z komiksowych kropek rastra pod tokenem, gdy najedziesz na niego, zaznaczysz go albo gdy jest jego tura w walce. Tylko ten klient.",
  "ITH.Settings.Hover.Name": "Aura tokenu: po najechaniu",
  "ITH.Settings.Hover.Hint": "Pokaż aurę, gdy wskaźnik jest nad tokenem.",
  "ITH.Settings.Selected.Name": "Aura tokenu: po zaznaczeniu",
  "ITH.Settings.Selected.Hint": "Pokaż aurę pod każdym zaznaczonym przez ciebie tokenem.",
  "ITH.Settings.Turn.Name": "Aura tokenu: aktywna tura",
  "ITH.Settings.Turn.Hint": "Mocniejsza, żółta aura z zewnętrznym pierścieniem większych kropek pod tokenem, którego jest tura w walce.",
  "ITH.Settings.Size.Name": "Aura tokenu: rozmiar",
  "ITH.Settings.Size.Hint": "Jak daleko pierścień sięga wokół tokenu.",
  "ITH.Settings.Size.small": "Mała",
  "ITH.Settings.Size.normal": "Normalna",
  "ITH.Settings.Size.large": "Duża",
  "ITH.Settings.Motion.Name": "Aura tokenu: ruch",
  "ITH.Settings.Motion.Hint": "Spokojny: aury pojawiają się łagodnie, a tylko aura aktywnej tury powoli oddycha. Żywy: każda aura oddycha, a część kropek migocze. Wyłączony: nic się nie rusza. Wyłączony także, gdy system prosi o ograniczenie ruchu albo Foundry działa w trybie niskiej wydajności.",
  "ITH.Settings.Motion.off": "Wyłączony",
  "ITH.Settings.Motion.calm": "Spokojny",
  "ITH.Settings.Motion.lively": "Żywy",
  "ITH.Settings.HideBorder.Name": "Aura tokenu: ukryj ramkę Foundry",
  "ITH.Settings.HideBorder.Hint": "Gdy aura jest widoczna, ukryj domyślną ramkę, którą Foundry rysuje przy najechaniu i zaznaczeniu. Wraca, gdy aura znika.",
  "ITH.Settings.HideMarker.Name": "Aura tokenu: ukryj znacznik tury Foundry",
  "ITH.Settings.HideMarker.Hint": "Gdy widoczna jest aura aktywnej tury, ukryj własny pierścień tury Foundry. Wraca, gdy aura znika."
};

let cacheLang = null, cache = EN;
export function t(key, data) {
  const lang = globalThis.game?.i18n?.lang ?? "en";
  if (lang !== cacheLang) { cacheLang = lang; cache = lang === "pl" ? { ...EN, ...PL } : EN; }
  const s = cache[key] ?? key;
  return data ? s.replace(/\{(\w+)\}/g, (m, k) => (data[k] === undefined ? m : String(data[k]))) : s;
}
