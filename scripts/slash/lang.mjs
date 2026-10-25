/* Comic slash transition strings (IPS.*), embedded because Foundry reads a module's language list only when the server starts.
   Same approach as the party cards: flat keys, English underneath, Polish on top, local t(). Parity check: node scripts/slash/check-lang.mjs */
export const EN = {
  "IPS.Type.Top": "Comic slash: from the top",
  "IPS.Type.Bottom": "Comic slash: from the bottom",
  "IPS.Type.Right": "Comic slash: from the right",
  "IPS.Type.Random": "Comic slash: random side",
  "IPS.Settings.Default.Name": "Comic slash: default scene transition",
  "IPS.Settings.Default.Hint": "GM only. Scenes whose own transition is \"None\" use this comic slash when they are viewed or activated (a scene with a transition of its own keeps it). Every scene can also pick a comic slash itself: Scene configuration, Transition. Off: nothing changes.",
  "IPS.Settings.Default.off": "Off",
  "IPS.Settings.Default.top": "From the top",
  "IPS.Settings.Default.bottom": "From the bottom",
  "IPS.Settings.Default.right": "From the right",
  "IPS.Settings.Default.random": "Random side",
  "IPS.Settings.Calm.Name": "Comic slash: plain fade only",
  "IPS.Settings.Calm.Hint": "Replace the comic slash with a quick plain fade on this client. Always on when your system asks for reduced motion."
};

export const PL = {
  "IPS.Type.Top": "Komiksowe cięcie: z góry",
  "IPS.Type.Bottom": "Komiksowe cięcie: z dołu",
  "IPS.Type.Right": "Komiksowe cięcie: z prawej",
  "IPS.Type.Random": "Komiksowe cięcie: losowa strona",
  "IPS.Settings.Default.Name": "Komiksowe cięcie: domyślne przejście scen",
  "IPS.Settings.Default.Hint": "Tylko MG. Sceny, których własne przejście to „Brak”, używają tego cięcia przy wyświetleniu lub aktywacji (scena z własnym przejściem je zachowuje). Każda scena może też wybrać cięcie sama: Konfiguracja sceny, Przejście. Wyłączone: nic się nie zmienia.",
  "IPS.Settings.Default.off": "Wyłączone",
  "IPS.Settings.Default.top": "Z góry",
  "IPS.Settings.Default.bottom": "Z dołu",
  "IPS.Settings.Default.right": "Z prawej",
  "IPS.Settings.Default.random": "Losowa strona",
  "IPS.Settings.Calm.Name": "Komiksowe cięcie: tylko zwykłe wygaszenie",
  "IPS.Settings.Calm.Hint": "Zastępuje komiksowe cięcie szybkim, zwykłym przenikaniem na tym kliencie. Zawsze włączone, gdy system prosi o ograniczenie ruchu."
};

/* Local resolver. Language: game.i18n.lang, PL on top of EN. A missing key shows the key (never throws). */
let cacheLang = null, cache = EN;
export function t(key, data) {
  const lang = globalThis.game?.i18n?.lang ?? "en";
  if (lang !== cacheLang) { cacheLang = lang; cache = lang === "pl" ? { ...EN, ...PL } : EN; }
  const s = cache[key] ?? key;
  return data ? s.replace(/\{(\w+)\}/g, (m, k) => (data[k] === undefined ? m : String(data[k]))) : s;
}
