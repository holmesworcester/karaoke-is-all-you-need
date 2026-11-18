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
args = parser.parse_args()
fontpath = Path(__file__).resolve().parents[1] / "assets/BarlowCondensed-Bold.ttf"
font = lambda size: ImageFont.truetype(str(fontpath), size)
W, H = 288, 192
# The glyph atlas is thresholded onto the CD+G pixel grid.
ft = font(20)
atlas = {}
for code in range(32, 127):
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


def tiles(im, ordered=False):
    a = np.asarray(im)
    result = []
    for y in range(0, H, 12):
        for x in range(0, W, 6):
            t = a[y : y + 12, x : x + 6]
            maximum = int(t.max())
            if maximum == 0:
                continue
            planes = []
            for b in range(4):
                mask = (t >> b) & 1
                if mask.any():
                    planes.append([b, *(mask @ np.array([32, 16, 8, 4, 2, 1])).tolist()])
            index = (x // 6 * 47 + y // 12 * 97 + x // 6 * (y // 12) * 13) % 257
            result.append([index, x // 6 + 1, y // 12 + 1, planes])
    if ordered:
        result.sort(key=lambda a: a[0])
    return [[x, y, planes] for _, x, y, planes in result]


header = Image.new("L", (W, H))
drawtext(
    header,
    (144, 83),
    args.title,
    min(31, max(8, round(31 * 260 / max(font(31).getlength(args.title), 260)))),
    1,
    "mt",
)
source = Image.open(args.cover).convert("L")
bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])
# The native end card must fit in the available 300-packet/s prefetch window.
width, height = 192, 174
while True:
    card = Image.new("L", (W, H))
    art = source.resize((width, height), Image.Resampling.LANCZOS)
    threshold = np.tile(bayer, ((height + 3) // 4, (width + 3) // 4))[:height, :width]
    pixels = (
        np.round(np.asarray(art) / 255 * 13 + (threshold - 7.5) / 16 * 0.9)
        .clip(0, 13)
        .astype("uint8")
    )
    card.paste(Image.fromarray(pixels), ((W - width) // 2, (H - height) // 2))
    outro = tiles(card, True)
    if sum(len(planes) for _, _, planes in outro) <= 760:
        break
    width, height = round(width * 0.9), round(height * 0.9)
rest = Image.new("L", (W, H))
drawtext(rest, (144, 91), "Instrumental", 21, 4, "mt")
live = ["080808", "999999", "ffffff", "000000", "aaaaaa", "444444"] + ["000000"] * 10
end = [("%02x" % int(round(i / 13 * 15) * 17)) * 3 for i in range(14)] + ["ffffff", "ffffff"]
asset = dict(atlas=atlas, header=tiles(header), outro=outro, rest=tiles(rest), live=live, end=end)
json.dump(asset, open(args.output, "w"), separators=(",", ":"))
print({k: len(v) for k, v in asset.items()}, sum(len(s[-1]) for s in asset["outro"]))
