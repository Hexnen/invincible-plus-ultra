#!/usr/bin/env python3
"""check-font.py - standalone helper for the "Font: comic lettering" option of Invincible - Plus Ultra.

WHAT IT DOES
  1. Prints which of the 18 Polish letters (and basic Latin A-Z a-z 0-9) a TTF / OTF / WOFF / WOFF2 font has (cmap based).
  2. With --patch it writes a Polish-completed COPY of a TrueType-outline font, composing every missing Polish letter from
     the font's OWN glyphs: base letter + the font's own acute / dot accent / ogonek (or cedilla) outlines, and a slanted bar
     across L / l for the stroked Ł ł. This is the same idea as the Komikah patch in ../fonts (see ../fonts/README.txt).
     The original file is never modified. Best effort: LOOK at the result (the script lists what it built) and fix by hand if needed.

  It only ever works on a font file YOU give it; it downloads and ships nothing. Respect the font's licence (a modified copy is
  a derivative: keep it private, for your own use; see ../fonts/user/README.txt).

USAGE
  python tools/check-font.py fonts/user/ActionFigureBB.ttf                 coverage report only
  python tools/check-font.py fonts/user/ActionFigureBB.ttf --patch         also writes ActionFigureBB-pl.ttf next to the input
  python tools/check-font.py some.ttf --patch --out C:/tmp/some-pl.ttf [--force]

  Exit codes: 0 report printed (and patch written when asked); 2 bad arguments / unreadable font / cannot patch.
  The module picks fonts/user/ActionFigureBB-pl.ttf automatically over ActionFigureBB.ttf when both exist.

REQUIRES  Python 3.8+ and fontTools (pip install fonttools; reading .woff2 also needs brotli).
"""
import argparse
import math
import sys
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.reverseContourPen import ReverseContourPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
except ImportError:  # pragma: no cover
    print("fontTools is required: pip install fonttools", file=sys.stderr)
    sys.exit(2)

if hasattr(sys.stdout, "reconfigure"):  # Polish letters in the report on a cp1250/cp1252 console
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def fail(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(2)



POLISH = "ĄąĆćĘęŁłŃńÓóŚśŹźŻż"
LATIN = {
    "A-Z": "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "a-z": "abcdefghijklmnopqrstuvwxyz",
    "0-9": "0123456789",
}
# target letter -> (glyph name, base letter, kind)  kind: acute | dot | ogonek | stroke | none(= Ó, plain acute)
RECIPES = {
    "Ą": ("Aogonek", "A", "ogonek"), "ą": ("aogonek", "a", "ogonek"),
    "Ć": ("Cacute", "C", "acute"), "ć": ("cacute", "c", "acute"),
    "Ę": ("Eogonek", "E", "ogonek"), "ę": ("eogonek", "e", "ogonek"),
    "Ł": ("Lslash", "L", "stroke"), "ł": ("lslash", "l", "stroke"),
    "Ń": ("Nacute", "N", "acute"), "ń": ("nacute", "n", "acute"),
    "Ó": ("Oacute", "O", "acute"), "ó": ("oacute", "o", "acute"),
    "Ś": ("Sacute", "S", "acute"), "ś": ("sacute", "s", "acute"),
    "Ź": ("Zacute", "Z", "acute"), "ź": ("zacute", "z", "acute"),
    "Ż": ("Zdotaccent", "Z", "dot"), "ż": ("zdotaccent", "z", "dot"),
}
# mark glyph candidates by code point, first one present wins
MARKS = {
    "acute": [0x00B4, 0x02CA, 0x0301],
    "dot": [0x02D9, 0x0307, 0x002E],
    "ogonek": [0x02DB, 0x0328],  # no real ogonek in the font -> a simple hook is drawn (see hook())
}


def load(path: Path) -> TTFont:
    try:
        return TTFont(str(path), lazy=False)
    except Exception as exc:  # unreadable / not a font
        fail(f"error: cannot read {path} as a font: {exc}")


def report(font: TTFont, cmap: dict) -> list:
    name = ""
    try:
        name = font["name"].getDebugName(4) or ""
    except Exception:
        pass
    print(f"Font: {name or '(unnamed)'}   glyphs: {len(font.getGlyphOrder())}   unitsPerEm: {font['head'].unitsPerEm}"
          f"   outlines: {'TrueType (glyf)' if 'glyf' in font else 'CFF' if 'CFF ' in font or 'CFF2' in font else '?'}")
    print("\nPolish letters:")
    missing = []
    for ch in POLISH:
        ok = ord(ch) in cmap
        if not ok:
            missing.append(ch)
        print(f"  {ch}  U+{ord(ch):04X}  {'ok' if ok else 'MISSING'}" + (f"  ({cmap[ord(ch)]})" if ok else ""))
    print("\nBasic Latin:")
    for label, chars in LATIN.items():
        lack = [c for c in chars if ord(c) not in cmap]
        print(f"  {label}: {'all present' if not lack else 'missing ' + ' '.join(lack)}")
    print(f"\nPolish: {len(POLISH) - len(missing)}/{len(POLISH)} present" + (f"; missing: {' '.join(missing)}" if missing else ""))
    return missing


def bounds(glyph_set, name):
    pen = BoundsPen(glyph_set)
    glyph_set[name].draw(pen)
    return pen.bounds  # (xMin, yMin, xMax, yMax) or None for an empty glyph


def outer_is_clockwise(rec) -> bool:
    """Direction of the largest contour of a recorded glyph (y-up: a negative shoelace area is clockwise). Contours we add must match it, or they punch holes."""
    best, area, cur = 0.0, 0.0, []
    for op, args in rec.value:
        if op == "moveTo":
            cur = [args[0]]
        elif op in ("lineTo", "qCurveTo", "curveTo"):
            cur.extend(a for a in args if a is not None)
        elif op in ("closePath", "endPath") and len(cur) > 2:
            a = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(cur, cur[1:] + cur[:1])) / 2
            if abs(a) > abs(best):
                best, area = a, a
    return area <= 0


def hook(pen, bx0, by0, bx1, bw, thick, upm):
    """A plain ogonek: a stroke of the font's stem thickness that leaves the base's right-bottom and curls right (quadratic contour)."""
    t = max(1.5 * thick, 0.06 * upm)
    h, w = 0.20 * upm, 0.17 * upm
    x = bx1 - 0.16 * bw - t          # left edge of the tail, under the right leg
    top = by0 + 1.3 * t              # starts inside the base so the shapes merge
    r = lambda *pt: tuple(round(v) for v in pt)
    pen.moveTo(r(x, top))
    pen.lineTo(r(x + t, top))                                            # across the top, then down the right side
    pen.lineTo(r(x + t, top - h + 2 * t))
    pen.qCurveTo(r(x + t, top - h + t), r(x + t + 0.5 * w, top - h + t))  # the inner turn into the arm's upper edge
    pen.lineTo(r(x + t + w, top - h + 1.5 * t))                          # up to the tip
    pen.lineTo(r(x + t + 0.9 * w, top - h + 0.4 * t))
    pen.qCurveTo(r(x + 0.3 * w + 0.4 * t, top - h - 0.2 * t), r(x, top - h + 0.4 * t), r(x, top - h + 2 * t))  # the outer bend, up the left side
    pen.closePath()


def patch(font: TTFont, cmap: dict, out: Path) -> None:
    if "glyf" not in font:
        fail("error: --patch supports TrueType outlines (glyf) only; this font is CFF/PostScript. Convert it to TTF first (e.g. with FontForge or otf2ttf), then run again.")
    upm = font["head"].unitsPerEm
    gs = font.getGlyphSet()
    order = list(font.getGlyphOrder())
    glyf, hmtx = font["glyf"], font["hmtx"]

    marks = {}
    for kind, cps in MARKS.items():
        for cp in cps:
            if cp in cmap and bounds(gs, cmap[cp]):
                marks[kind] = cmap[cp]
                break
    # stroke thickness: from the period (a dot is about as thick as the font's stems) else a default
    thick = 0.06 * upm
    if 0x2E in cmap and bounds(gs, cmap[0x2E]):
        b = bounds(gs, cmap[0x2E])
        thick = max(0.04 * upm, min(b[2] - b[0], b[3] - b[1]) * 0.55)

    made, reused, skipped, cache = [], [], [], {}
    synthetic_hook = False
    for ch in POLISH:
        cp = ord(ch)
        if cp in cmap:
            continue
        gname, base_ch, kind = RECIPES[ch]
        base = cmap.get(ord(base_ch))
        if base is None or not bounds(gs, base):
            skipped.append((ch, f"base letter {base_ch} missing"))
            continue
        if kind not in ("stroke", "ogonek") and kind not in marks:
            skipped.append((ch, f"no {kind} mark glyph in the font"))
            continue
        key = (base, kind)  # an all-caps font maps a / A to one glyph: build once, share it
        if key in cache:
            cmap_target = cache[key]
            reused.append((ch, cmap_target))
        else:
            bx0, by0, bx1, by1 = bounds(gs, base)
            bw, bh = bx1 - bx0, by1 - by0
            rec = DecomposingRecordingPen(gs)
            gs[base].draw(rec)
            pen = TTGlyphPen(None)
            rec.replay(pen)  # the base outline, decomposed
            cw = outer_is_clockwise(rec)
            add = pen if cw else ReverseContourPen(pen)  # our own contours get the base's direction
            if kind == "stroke":
                narrow = bw < 0.45 * bh
                cx = (bx0 + bx1) / 2 if narrow else bx0 + 0.28 * bw
                cy = by0 + 0.52 * bh
                hl = max(0.55 * bw, 0.14 * bh) if narrow else 0.34 * bw
                ang = math.radians(25)
                ux, uy, nx, ny = math.cos(ang), math.sin(ang), -math.sin(ang), math.cos(ang)
                t2 = thick / 2
                pts = [  # drawn clockwise; ReverseContourPen flips it when the font's outlines run the other way
                    (cx - hl * ux + t2 * nx, cy - hl * uy + t2 * ny), (cx + hl * ux + t2 * nx, cy + hl * uy + t2 * ny),
                    (cx + hl * ux - t2 * nx, cy + hl * uy - t2 * ny), (cx - hl * ux - t2 * nx, cy - hl * uy - t2 * ny)]
                add.moveTo(tuple(round(v) for v in pts[0]))
                for p in pts[1:]:
                    add.lineTo(tuple(round(v) for v in p))
                add.closePath()
            elif kind == "ogonek" and "ogonek" not in marks:
                hook(add, bx0, by0, bx1, bw, thick, upm)
                synthetic_hook = True
            else:
                m = marks[kind]
                mb = bounds(gs, m)
                gap = 0.045 * upm
                mw = mb[2] - mb[0]
                if kind == "ogonek":  # hangs from the bottom right of the base
                    dx = bx1 - mb[2] - 0.04 * bw
                    dy = (by0 + 0.02 * upm) - mb[3]
                else:  # centred above the base, a small gap over its top
                    dx = (bx0 + bx1) / 2 - (mb[0] + mb[2]) / 2
                    dy = (by1 + gap) - mb[1]
                mrec = DecomposingRecordingPen(gs)
                gs[m].draw(mrec)
                mrec.replay(TransformPen(pen, (1, 0, 0, 1, dx, dy)))
            try:
                glyph = pen.glyph()
            except NotImplementedError as exc:
                fail(f"error: cubic outlines cannot be composed into a TrueType glyph ({exc}); convert the font to quadratic TTF first.")
            glyph.recalcBounds(glyf)
            new = gname
            while new in glyf.glyphs:  # never clobber an existing glyph name
                new += ".pl"
            order.append(new)
            glyf.glyphs[new] = glyph
            hmtx.metrics[new] = (hmtx.metrics[base][0], getattr(glyph, "xMin", 0))
            cache[key] = new
            cmap_target = new
            made.append((ch, new, kind))
        for table in font["cmap"].tables:
            if table.isUnicode():
                table.cmap[cp] = cmap_target
        cmap[cp] = cmap_target

    font.setGlyphOrder(order)
    glyf.glyphOrder = order
    # anything that is keyed per glyph and now stale, or a signature that no longer matches the edited file
    for tag in ("DSIG", "hdmx", "LTSH", "VDMX"):
        if tag in font:
            del font[tag]
    if "OS/2" in font:  # declare Latin Extended-A / Latin 2 support
        font["OS/2"].ulUnicodeRange1 |= 1 << 30
        font["OS/2"].ulCodePageRange1 |= 1 << 1
    font.flavor = None
    out.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(out))

    print(f"\nPatched copy written: {out}")
    for ch, new, kind in made:
        print(f"  built   {ch}  -> {new}  ({kind})")
    for ch, new in reused:
        print(f"  shared  {ch}  -> {new}  (same base glyph as its other case)")
    for ch, why in skipped:
        print(f"  SKIPPED {ch}  ({why})")
    if synthetic_hook:
        print("  note: the font has no ogonek glyph, a plain hook was drawn for Ą ą Ę ę: check how it looks.")
    print("  Check the result visually (type the 18 letters in a text editor / the module with the font option on).")


def main() -> None:
    ap = argparse.ArgumentParser(description="Report Polish / basic Latin coverage of a font; optionally build a Polish-completed copy.",
                                 epilog="Works only on a file you supply. Nothing is downloaded.")
    ap.add_argument("font", help="path to a .ttf / .otf / .woff / .woff2 file")
    ap.add_argument("--patch", action="store_true", help="write a copy with the missing Polish letters composed (TrueType outlines only)")
    ap.add_argument("--out", help="output path for --patch (default: ActionFigureBB-pl.ttf next to the input)")
    ap.add_argument("--force", action="store_true", help="overwrite an existing output file")
    args = ap.parse_args()

    src = Path(args.font)
    if not src.is_file():
        fail(f"error: no such file: {src}")
    font = load(src)
    cmap = dict(font.getBestCmap() or {})
    if not cmap:
        fail("error: the font has no Unicode cmap")
    missing = report(font, cmap)
    if not args.patch:
        return
    out = Path(args.out) if args.out else src.with_name("ActionFigureBB-pl.ttf")
    if out.resolve() == src.resolve():
        fail("error: the output would overwrite the input; choose another --out")
    if out.exists() and not args.force:
        fail(f"error: {out} exists; use --force to overwrite")
    if not missing:
        print("\nNothing to patch: every Polish letter is already present.")
        return
    patch(font, cmap, out)


if __name__ == "__main__":
    main()
