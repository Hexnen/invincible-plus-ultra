"""Design preview for the token halo (scripts/tokenhalo/). It does NOT reimplement the dot algorithm: it runs
`node scripts/tokenhalo/dots.mjs --dump` and draws the returned dots the way halo.mjs bakes them
(disc dots in ink at low alpha, then the ink duplicate offset by a few px, then the colour dots).

usage: python tools/halo-preview.py [out_dir]     (needs node and Pillow)
writes halo-sheet-{dark,light}.png, halo-sizes-{dark,light}.png, halo-seeds-{dark,light}.png"""
import json, random, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
MOD = HERE.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
OUT.mkdir(parents=True, exist_ok=True)
data = json.loads(subprocess.run(["node", str(MOD / "scripts/tokenhalo/dots.mjs"), "--dump"], capture_output=True, check=True).stdout)
PAL, CASES = data["palette"], data["cases"]
ALPHA = {"hover": 0.82, "select": 0.92, "turn": 0.94}   # the sprite alpha halo.mjs uses per variant
SS = 4      # supersampling
Z = 2       # preview zoom (a 1x1 token = 200 px)


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def map_bg(w, h, dark, seed=7):
    rnd = random.Random(seed)
    base = (34, 38, 46) if dark else (214, 205, 184)
    im = Image.new("RGB", (w, h), base)
    d = ImageDraw.Draw(im)
    step = 100 * Z
    line = (58, 64, 76) if dark else (176, 165, 142)
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=line, width=1)
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=line, width=1)
    for _ in range(900):
        x, y = rnd.randrange(w), rnd.randrange(h)
        v = rnd.randint(-14, 14)
        r = rnd.randint(1, 3)
        c = tuple(max(0, min(255, b + v)) for b in base)
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)
    return im


def halo_layer(case, color):
    ext = int(case["extent"] + case["ink"]["y"] + 6)
    W = 2 * ext * Z * SS
    lay = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    c = W / 2
    k = Z * SS
    a = ALPHA[case["variant"]]
    ink = hexrgb(PAL["ink"])
    col = hexrgb(color)
    dr = ImageDraw.Draw(lay, "RGBA")

    def circ(x, y, r, rgba):
        dr.ellipse([c + (x - r) * k, c + (y - r) * k, c + (x + r) * k, c + (y + r) * k], fill=rgba)

    for d in case["dots"]:
        if d["k"] == "disc":
            circ(d["x"], d["y"], d["r"], ink + (int(255 * 0.26),))
    for d in case["dots"]:
        if d["k"] != "disc":
            circ(d["x"] + case["ink"]["x"], d["y"] + case["ink"]["y"], d["r"], ink + (int(255 * 0.9),))
    for d in case["dots"]:
        if d["k"] != "disc":
            circ(d["x"], d["y"], d["r"], col + (int(255 * a),))
    return lay


def paste_halo(bg, case, color, cx, cy):
    lay = halo_layer(case, color)
    small = lay.resize((lay.width // SS, lay.height // SS), Image.LANCZOS)
    bg.paste(small, (int(cx - small.width / 2), int(cy - small.height / 2)), small)


def paste_token(bg, size_px, cx, cy):
    """a placeholder token drawn OVER the halo (the real token mesh is above it)"""
    r = size_px / 2 * Z
    im = Image.new("RGBA", (int(2 * r * SS) + 8, int(2 * r * SS) + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    o = 3
    d.ellipse([o, o, o + 2 * r * SS, o + 2 * r * SS], fill=(88, 74, 66, 255), outline=(20, 18, 16, 255), width=int(3 * SS))
    d.ellipse([o + r * SS * 0.55, o + r * SS * 0.5, o + r * SS * 0.95, o + r * SS * 0.9], fill=(196, 160, 132, 255))
    d.ellipse([o + r * SS * 1.05, o + r * SS * 0.5, o + r * SS * 1.45, o + r * SS * 0.9], fill=(196, 160, 132, 255))
    d.rectangle([o + r * SS * 0.5, o + r * SS * 1.15, o + r * SS * 1.5, o + r * SS * 1.7], fill=(60, 80, 120, 255))
    small = im.resize((im.width // SS, im.height // SS), Image.LANCZOS)
    bg.paste(small, (int(cx - small.width / 2), int(cy - small.height / 2)), small)


def find(name, variant, seed):
    return next(c for c in CASES if c["name"] == name and c["variant"] == variant and c["seed"] == seed)


def sheet(dark, name):
    disp = [("friendly", PAL["friendly"], "tokenAAAA"), ("neutral", PAL["neutral"], "tokenBBBB"),
            ("hostile", PAL["hostile"], "tokenCCCC"), ("secret", PAL["secret"], "tokenAAAA")]
    cols = ["hover", "select", "turn"]
    cell = 240 * Z
    bg = map_bg(cell * 3, cell * len(disp), dark)
    for ri, (_dn, color, seed) in enumerate(disp):
        for ci, v in enumerate(cols):
            case = find("1x1", v, seed)
            col = PAL["turn"] if v == "turn" else color
            cx, cy = cell * ci + cell / 2, cell * ri + cell / 2
            paste_halo(bg, case, col, cx, cy)
            paste_token(bg, 100, cx, cy)
    bg.save(OUT / f"halo-sheet-{name}.png")


def sizes(dark, name):
    rows = [("half", 50), ("1x1", 100), ("2x2", 200), ("4x4", 400)]
    pad = 110
    cw = [(s + 2 * pad) * Z for _, s in rows]
    bg = map_bg(max(cw) * 2, sum(cw), dark, 11)
    y = 0
    for (nm, s), h in zip(rows, cw):
        for ci, v in enumerate(["select", "turn"]):
            case = find(nm, v, "tokenBBBB")
            color = PAL["hostile"] if ci == 0 else PAL["turn"]
            cx, cy = max(cw) * ci + max(cw) / 2, y + h / 2
            paste_halo(bg, case, color, cx, cy)
            paste_token(bg, s, cx, cy)
        y += h
    bg.save(OUT / f"halo-sizes-{name}.png")


def seeds(dark, name):
    """same disposition and size, three seeds: every ring must be its own shape, and none a regular circle"""
    cell = 240 * Z
    bg = map_bg(cell * 3, cell, dark, 3)
    for i, sd in enumerate(["tokenAAAA", "tokenBBBB", "tokenCCCC"]):
        case = find("1x1", "select", sd)
        paste_halo(bg, case, PAL["friendly"], cell * i + cell / 2, cell / 2)
        paste_token(bg, 100, cell * i + cell / 2, cell / 2)
    bg.save(OUT / f"halo-seeds-{name}.png")


for is_dark, nm in ((True, "dark"), (False, "light")):
    sheet(is_dark, nm)
    sizes(is_dark, nm)
    seeds(is_dark, nm)
print("wrote previews to", OUT, "| cases:", len(CASES), "| dots in 1x1 select:", len(find("1x1", "select", "tokenAAAA")["dots"]))
