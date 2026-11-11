/* The names of THE MARKS (scripts/kit.mjs, ledger U86 / U93): what a tooltip and a screen reader say for a drawing. Embedded, like the
   other tables of the module (Foundry reads a module's language list only when the server starts). The same key set in both languages
   (scripts/check-marks.mjs). Polish: the closest word, the fewest words (dev/glossary-pl.md). */
export const MARK_EN = Object.freeze({
  full: "Full action", quick: "Quick action", turn: "Whole turn", long: "Longer than a turn", none: "No action", gm: "The GM decides",
  out: "Interrupt", outQuick: "Interrupt: quick action", outFull: "Interrupt: full action", spent: "Spent",
  stress: "Stress", health: "Health", damage: "Damage", extra: "Extra damage", armor: "Armor", pierce: "Ignores Armor",
  rmin: "Minimum range", rmax: "Maximum range", range: "Range", dice: "Dice", six: "Sixes", push: "Push", crit: "Critical injury", cond: "Condition",
  legend: "Marks", "legend.time": "Time", "legend.things": "Price and effect", "legend.roll": "Roll and state", "legend.close": "Close",
});
export const MARK_PL = Object.freeze({
  full: "Pełna akcja", quick: "Szybka akcja", turn: "Cała tura", long: "Dłużej niż tura", none: "Bez akcji", gm: "Decyduje MG",
  out: "Akcja przerywająca", outQuick: "Przerywająca: szybka akcja", outFull: "Przerywająca: pełna akcja", spent: "Zużyta",
  stress: "Stres", health: "Zdrowie", damage: "Obrażenia", extra: "Dodatkowe obrażenia", armor: "Pancerz", pierce: "Pomija Pancerz",
  rmin: "Zasięg minimalny", rmax: "Zasięg maksymalny", range: "Zasięg", dice: "Kości", six: "Szóstki", push: "Forsowanie", crit: "Rana krytyczna", cond: "Stan",
  legend: "Znaki", "legend.time": "Czas", "legend.things": "Cena i skutek", "legend.roll": "Rzut i stan", "legend.close": "Zamknij",
});
