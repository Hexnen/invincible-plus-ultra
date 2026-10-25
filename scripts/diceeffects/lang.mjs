/* Dice effects strings (IDF.*), embedded like the other features' (scripts/turn/lang.mjs): Foundry reads a module's language list only when the
   server starts, so t() reads these tables directly. Flat keys, English underneath, Polish on top. Parity check: node scripts/diceeffects/check-lang.mjs */
export const EN = {
  "IDF.Settings.Enabled.Name": "Dice effects: enabled",
  "IDF.Settings.Enabled.Hint": "Comic effects drawn under the Dice So Nice dice once they come to rest: a golden halftone burst under a 6, a magenta X in a halftone ring under a 1. Needs Dice So Nice. This client only.",
  "IDF.Settings.Strength.Name": "Dice effects: strength",
  "IDF.Settings.Strength.Hint": "Subtle is a halftone ring; Bold makes the marks bigger and adds the starburst under a 6.",
  "IDF.Settings.Strength.off": "Off",
  "IDF.Settings.Strength.subtle": "Subtle",
  "IDF.Settings.Strength.bold": "Bold",
  "IDF.Settings.Sixes.Name": "Dice effects: under sixes",
  "IDF.Settings.Sixes.Hint": "A golden halftone burst under every die that shows a 6.",
  "IDF.Settings.OnesPush.Name": "Dice effects: ones only on a push",
  "IDF.Settings.OnesPush.Hint": "In Year Zero a 1 only hurts when you push, so the mark under a 1 appears only on pushed rolls. Turn this off to see it on every roll.",
  "IDF.Settings.Ones.Name": "Dice effects: under ones",
  "IDF.Settings.Ones.Hint": "A magenta X in a halftone ring under every die that shows a 1."
};

export const PL = {
  "IDF.Settings.Enabled.Name": "Efekty kości: włączone",
  "IDF.Settings.Enabled.Hint": "Komiksowe efekty pod kośćmi Dice So Nice, gdy się zatrzymają: złoty rastrowy wybuch pod szóstką, magentowy krzyżyk w rastrowym pierścieniu pod jedynką. Wymaga Dice So Nice. Tylko ten klient.",
  "IDF.Settings.Strength.Name": "Efekty kości: siła",
  "IDF.Settings.Strength.Hint": "Subtelne to rastrowy pierścień; Mocne powiększa znaki i dodaje gwiazdę wybuchu pod szóstką.",
  "IDF.Settings.Strength.off": "Wyłączone",
  "IDF.Settings.Strength.subtle": "Subtelne",
  "IDF.Settings.Strength.bold": "Mocne",
  "IDF.Settings.Sixes.Name": "Efekty kości: pod szóstkami",
  "IDF.Settings.Sixes.Hint": "Złoty rastrowy wybuch pod każdą kością, która pokazuje 6.",
  "IDF.Settings.OnesPush.Name": "Efekty kości: jedynki tylko przy pushu",
  "IDF.Settings.OnesPush.Hint": "W Year Zero jedynka boli dopiero przy pushu, więc znak pod jedynką pojawia się tylko przy rzutach z pushem. Wyłącz, by widzieć go przy każdym rzucie.",
  "IDF.Settings.Ones.Name": "Efekty kości: pod jedynkami",
  "IDF.Settings.Ones.Hint": "Magentowy krzyżyk w rastrowym pierścieniu pod każdą kością, która pokazuje 1."
};

let cacheLang = null, cache = EN;
export function t(key, data) {
  const lang = globalThis.game?.i18n?.lang ?? "en";
  if (lang !== cacheLang) { cacheLang = lang; cache = lang === "pl" ? { ...EN, ...PL } : EN; }
  const s = cache[key] ?? key;
  return data ? s.replace(/\{(\w+)\}/g, (m, k) => (data[k] === undefined ? m : String(data[k]))) : s;
}
