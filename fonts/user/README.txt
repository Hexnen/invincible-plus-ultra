FONTS YOU SUPPLY YOURSELF / CZCIONKI DOSTARCZANE PRZEZ CIEBIE
================================================================

ENGLISH
-------
This folder is for the optional "ActionFigure (Absolute Batman style)" lettering,
setting "Font: comic lettering" in the module settings.

  1. Obtain your own licensed copy of ActionFigure BB (Blambot).
     NOTE: the free trial / mirror copies of ActionFigure (e.g. on OnlineWebFonts) are trimmed subsets (about 57 glyphs, no Polish letters,
     most capitals missing) and are not usable. Get the full official file from Blambot. Free bundled alternatives (Anton, Bangers) are in the
     same setting and need no file.
  2. Save it here as   ActionFigureBB.ttf   (ActionFigureBB.otf / .woff2 / .woff also work).
  3. In Settings > Configure Settings > Invincible - Plus Ultra choose
     "Font: comic lettering" = "ActionFigure (Absolute Batman style)". It applies at once, no reload.

If the file is missing or unreadable, the default Komikah stays in use and a warning tells you where to put it.
If the font lacks some Polish letters, those characters are taken from the module's patched Komikah (mixed look).
To complete the Polish letters inside the font itself, run (needs Python + fontTools, `pip install fonttools`):
    python tools/check-font.py fonts/user/ActionFigureBB.ttf            (coverage report)
    python tools/check-font.py fonts/user/ActionFigureBB.ttf --patch    (writes ActionFigureBB-pl.ttf here; it is preferred automatically)

Licence (summary, check the current terms on blambot.com yourself): Blambot allows free use of its comic
fonts for independent comic creators in print or flattened graphics. Embedding a font as a webfont or inside an
app / module needs a licence from Blambot. YOU are responsible for holding the right licence for how you use it.
This module NEVER ships or downloads the font; nothing in this folder except this README is distributed with it
(see .gitignore). Do not publish or redistribute your copy.

POLSKI
------
Ten folder jest na opcjonalne pismo "ActionFigure (styl Absolute Batman)",
ustawienie "Font: pismo komiksowe" w ustawieniach modułu.

  1. Zdobądź własną, licencjonowaną kopię ActionFigure BB (Blambot).
     UWAGA: darmowe wersje próbne / kopie z serwisów typu OnlineWebFonts są okrojone (ok. 57 znaków, bez polskich liter, brak większości
     wielkich liter) i nie nadają się. Pełny, oficjalny plik weź z Blambot. Darmowe, dołączone zamienniki (Anton, Bangers) są w tym samym
     ustawieniu i nie wymagają żadnego pliku.
  2. Zapisz ją tutaj jako   ActionFigureBB.ttf   (działa też ActionFigureBB.otf / .woff2 / .woff).
  3. W Ustawienia > Konfiguruj ustawienia > Invincible - Plus Ultra wybierz
     "Font: pismo komiksowe" = "ActionFigure (styl Absolute Batman)". Działa od razu, bez przeładowania.

Gdy pliku brak lub nie da się go wczytać, zostaje domyślny Komikah, a ostrzeżenie wskazuje, gdzie go umieścić.
Jeśli w foncie brakuje polskich liter, te znaki są brane z załatanego Komikah modułu (mieszany wygląd).
Aby dopełnić polskie litery w samym foncie, uruchom (Python + fontTools, `pip install fonttools`):
    python tools/check-font.py fonts/user/ActionFigureBB.ttf            (raport pokrycia)
    python tools/check-font.py fonts/user/ActionFigureBB.ttf --patch    (zapisuje tu ActionFigureBB-pl.ttf; jest wybierany automatycznie)

Licencja (streszczenie, aktualne warunki sprawdź sam na blambot.com): Blambot pozwala niezależnym twórcom
komiksów używać swoich fontów za darmo w druku lub w spłaszczonej grafice. Osadzenie fontu jako webfont albo
w aplikacji / module wymaga licencji od Blambot. TY odpowiadasz za posiadanie właściwej licencji do swojego
sposobu użycia. Ten moduł NIGDY nie dołącza ani nie pobiera fontu; poza tym README nic z tego folderu nie
jest dystrybuowane (zob. .gitignore). Nie publikuj ani nie udostępniaj swojej kopii.
