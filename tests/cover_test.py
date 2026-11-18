"""Check color CD+G slides and accented lyrics in a full browser-to-MP4 export."""

import io
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image

folder = Path("build/cover-test")
folder.mkdir(parents=True, exist_ok=True)
colors = ["#112233", "#99aabb", "#ffeecc"]
img = Image.new("RGB", (128, 128), "#bb3311")
img.paste("#2255bb", (64, 0, 128, 128))
img.paste("#ddcc55", (48, 40, 80, 88))
img.save(folder / "cover.png")
art_command = [
    sys.executable,
    "scripts/art.py",
    "Été",
    folder / "cover.png",
    folder / "art.json",
    "--cover-palette",
]
invalid = subprocess.run(
    [*art_command, "#222222", "#333333", "#444444"], capture_output=True
)
assert invalid.returncode and b"contrast" in invalid.stderr
subprocess.run([*art_command, *colors], check=True)
art = json.loads((folder / "art.json").read_text())
assert art["atlas"]["é"] != art["atlas"]["e"]
assert art["atlas"]["œ"] != art["atlas"]["?"]
assert art["live"][:3] == [c[1:] for c in colors]
(folder / "words.lrc").write_text("[00:11.00] Été\n")
(folder / "timing.json").write_text("[[[11000,12000]]]")
(folder / "song.json").write_text(
    json.dumps(
        dict(
            title="Été",
            lyrics="words.lrc",
            timing="timing.json",
            art="art.json",
            audio="song.wav",
        )
    )
)
subprocess.run(
    [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=17",
        folder / "song.wav",
    ],
    check=True,
)
subprocess.run(
    ["node", "scripts/build-player.mjs", folder / "song.json", folder / "player.html"],
    check=True,
)
subprocess.run(
    [
        "node",
        "video/export.mjs",
        folder / "player.html",
        folder / "video.mp4",
        "--jobs",
        "1",
    ],
    check=True,
)


def frame(t):
    png = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            str(t),
            "-i",
            folder / "video.mp4",
            "-frames:v",
            "1",
            "-threads",
            "1",
            "-f",
            "image2pipe",
            "-c:v",
            "png",
            "-",
        ]
    )
    return np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(float)


cover = frame(6)
end = frame(16.4)
for y, x, rgb in [
    (540, 750, [187, 51, 17]),
    (540, 960, [221, 204, 85]),
    (540, 1170, [34, 85, 187]),
]:
    assert max(abs(cover[y, x] - rgb)) < 7, (cover[y, x], rgb)
    assert max(abs(cover[y, x] - end[y, x])) < 7
assert frame(3.1)[540, 750, 0] < cover[540, 750, 0] - 55
assert frame(7.85)[540, 750, 0] < cover[540, 750, 0] - 70
waiting, partial, sung = (frame(t) for t in [10.8, 11.5, 12.04])
assert max(abs(waiting[0, 0] - [17, 34, 51])) < 6
foreground = np.max(abs(waiting - [153, 170, 187]), axis=2) < 7
assert foreground.sum() > 1000
highlighted = np.max(abs(partial - [255, 238, 204]), axis=2) < 7
assert 0.25 < highlighted[foreground].mean() < 0.75
# 4:2:0 chroma shares samples with the background at glyph edges. Check every
# ink pixel for the sweep and compare the glyph's median color with the palette.
assert np.all((sung[:, :, 0] - waiting[:, :, 0])[foreground] > 40)
assert max(abs(np.median(sung[foreground], axis=0) - [255, 238, 204])) < 5
print(
    "Verified the cover fade at both ends, native cover colors, and the accented lyric sweep."
)
