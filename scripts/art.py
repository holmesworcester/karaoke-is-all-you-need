import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(
    description="Make a 16-color CD+G title, font atlas and artwork fade"
)
parser.add_argument("title")
parser.add_argument("cover", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument(
    "--cover-palette",
    nargs=3,
    metavar=("BACKGROUND", "LYRIC", "SWEEP"),
    help="Use a color cover and three hex lyric colors sampled from its artwork",
)
args = parser.parse_args()


def luminance(rgb):
    s = np.asarray(rgb, dtype=float) / 255
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4) @ [
        0.2126,
        0.7152,
        0.0722,
    ]


def contrast(a, b):
    x, y = sorted([luminance(a), luminance(b)])
    return (y + 0.05) / (x + 0.05)


if args.cover_palette:
    try:
        colors = [bytes.fromhex(s.removeprefix("#")) for s in args.cover_palette]
    except ValueError:
        parser.error("Each palette color requires six hex digits")
    if any(len(c) != 3 for c in colors):
        parser.error("Each palette color requires six hex digits")
    colors = [[round(c / 17) * 17 for c in rgb] for rgb in colors]
    colors[1:] = sorted(colors[1:], key=luminance)
    bg, ink, sweep = colors
    if min(contrast(bg, ink), contrast(bg, sweep)) < 4.5 or contrast(ink, sweep) < 2:
        parser.error(
            "The native palette needs 4.5:1 text contrast and 2:1 sweep contrast"
        )

fontpath = Path(__file__).resolve().parents[1] / "assets/BarlowCondensed-Bold.ttf"
font = lambda size: ImageFont.truetype(str(fontpath), size)
W, H = 288, 192
# The glyph atlas is thresholded onto the CD+G pixel grid.
ft = font(20)
atlas = {}
for code in [*range(32, 127), *range(192, 256), ord("œ"), ord("Œ")]:
    c = chr(code)
    w = int(round(ft.getlength(c)))
    im = Image.new("L", (max(1, w + 2), 24))
    d = ImageDraw.Draw(im)
    d.text((0, -2), c, font=ft, fill=255, stroke_width=0)
    bits = np.asarray(im) > 85
    atlas[c] = [w, [sum(int(x) << k for k, x in enumerate(row)) for row in bits]]


def drawtext(img, xy, s, size, index, anchor="lt"):
    layer = Image.new("L", img.size)
    ImageDraw.Draw(layer).text(xy, s, font=font(size), fill=255, anchor=anchor)
    img.paste(index, (0, 0, *img.size), layer.point(lambda x: 255 if x >= 100 else 0))


def color_planes(tile):
    # Choose an affine basis for the colors in this tile. A two-color tile costs
    # one native packet even when its palette indices differ in all four bits.
    colors, counts = np.unique(tile, return_counts=True)
    base = int(colors[counts.argmax()])
    codes = {base: 0}
    basis = []
    for color in colors.tolist():
        if color not in codes:
            delta = color ^ base
            bit = 1 << len(basis)
            codes.update({c ^ delta: v | bit for c, v in list(codes.items())})
            basis.append(delta)
    indices = np.zeros(16, dtype=np.uint8)
    for color, code in codes.items():
        indices[color] = code
    masks = indices[tile]
    weights = np.array([32, 16, 8, 4, 2, 1])
    return [
        [delta, *(((masks >> i) & 1) @ weights).tolist()]
        for i, delta in enumerate(basis or [0])
    ], base


def tiles(im, ordered=False, color=False):
    a = np.asarray(im)
    result = []
    for y in range(0, H, 12):
        for x in range(0, W, 6):
            t = a[y : y + 12, x : x + 6]
            maximum = int(t.max())
            if maximum == 0:
                continue
            planes = []
            if color:
                planes, base = color_planes(t)
            else:
                for b in range(4):
                    mask = (t >> b) & 1
                    if mask.any():
                        planes.append(
                            [b, *(mask @ np.array([32, 16, 8, 4, 2, 1])).tolist()]
                        )
            index = (x // 6 * 47 + y // 12 * 97 + x // 6 * (y // 12) * 13) % 257
            result.append(
                [index, x // 6 + 1, y // 12 + 1, planes, *([base] if color else [])]
            )
    if ordered:
        result.sort(key=lambda a: a[0])
    return [item[1:] for item in result]


header = Image.new("L", (W, H))
drawtext(
    header,
    (144, 83),
    args.title,
    min(31, max(8, round(31 * 260 / max(font(31).getlength(args.title), 260)))),
    1,
    "mt",
)
source = Image.open(args.cover).convert("RGB" if args.cover_palette else "L")
if args.cover_palette:
    # Reserve index zero for the black screen around the cover.
    thumb = source.copy()
    thumb.thumbnail((192, 192))
    native = thumb.point(lambda v: round(v / 17) * 17)
    reduced = native.quantize(15, method=Image.Quantize.MEDIANCUT)
    table = [0, 0, 0] + reduced.getpalette()[:45]
    table = [round(v / 17) * 17 for v in table]
    table += [0] * (48 - len(table))
    swatches = Image.new("P", (1, 1))
    swatches.putpalette(table + [0] * (768 - len(table)))

bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])
# The native end card must fit in the available 300-packet/s prefetch window.
width, height = 192, 174
while True:
    card = Image.new("L", (W, H))
    art = source.resize((width, height), Image.Resampling.LANCZOS)
    if args.cover_palette:
        pixels = np.asarray(
            art.quantize(palette=swatches, dither=Image.Dither.FLOYDSTEINBERG)
        )
    else:
        threshold = np.tile(bayer, ((height + 3) // 4, (width + 3) // 4))[
            :height, :width
        ]
        pixels = (
            np.round(np.asarray(art) / 255 * 13 + (threshold - 7.5) / 16 * 0.9)
            .clip(0, 13)
            .astype("uint8")
        )
    card.paste(Image.fromarray(pixels), ((W - width) // 2, (H - height) // 2))
    outro = tiles(card, True, color=bool(args.cover_palette))
    if sum(len(planes) for _, _, planes, *_ in outro) <= 760:
        break
    width, height = round(width * 0.9), round(height * 0.9)
rest = Image.new("L", (W, H))
drawtext(rest, (144, 91), "Instrumental", 21, 4, "mt")
live = ["080808", "999999", "ffffff", "000000", "aaaaaa", "444444"] + ["000000"] * 10
end = [("%02x" % int(round(i / 13 * 15) * 17)) * 3 for i in range(14)] + [
    "ffffff",
    "ffffff",
]
if args.cover_palette:
    bg, ink, sweep = [bytes(rgb).hex() for rgb in colors]
    live = [bg, ink, sweep, bg, ink, ink] + [bg] * 10
    end = [bytes(table[i : i + 3]).hex() for i in range(0, 48, 3)]
asset = dict(
    atlas=atlas, header=tiles(header), outro=outro, rest=tiles(rest), live=live, end=end
)
if args.cover_palette:
    asset["coverPalette"] = True
json.dump(asset, open(args.output, "w"), separators=(",", ":"))
print(
    {k: len(v) for k, v in asset.items() if isinstance(v, (list, dict))},
    sum(len(s[2]) for s in asset["outro"]),
)
