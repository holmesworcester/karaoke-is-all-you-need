"""Render a new song from scratch, then inspect frames and audio in the resulting MP4."""

import io
import json
import subprocess as sp
import sys
from pathlib import Path

import numpy as np
from PIL import Image

d = Path("build/roundtrip")
d.mkdir(exist_ok=True, parents=True)
title = "Rise & Sing"
cover = Image.new("L", (48, 48), color=0)
cover.paste(230, (9, 9, 39, 39))
cover.save(d / "cover.png")
sp.run([sys.executable, "scripts/art.py", title, d / "cover.png", d / "art.json"], check=True)
sp.run(
    [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=12",
        "-ac",
        "2",
        d / "song.wav",
    ],
    check=True,
)
(d / "words.lrc").write_text("[00:04.60] Rise up\n[00:06.30] Sing again\n")
(d / "timing.json").write_text(
    json.dumps([[[4600, 5100], [5250, 5500]], [[6300, 6730], [6800, 7290]]])
)
(d / "song.json").write_text(
    json.dumps(
        dict(
            title=title, audio="song.wav", art="art.json", timing="timing.json", lyrics="words.lrc"
        )
    )
)
sp.run(["node", "scripts/build-player.mjs", d / "song.json", d / "player.html"], check=True)
sp.run(["node", "video/export.mjs", d / "player.html", d / "render.mp4", "--jobs", "1"], check=True)
streams = json.loads(
    sp.check_output(["ffprobe", "-v", "error", "-show_streams", "-of", "json", d / "render.mp4"])
)["streams"]
video, audio = streams
assert (video["codec_name"], video["width"], video["height"], video["r_frame_rate"]) == (
    "h264",
    1920,
    1080,
    "60/1",
)
assert abs(int(video["nb_frames"]) - 720) <= 1
assert audio["codec_name"] == "aac" and abs(float(audio["duration"]) - 12) < 0.03


def frame(time):
    png = sp.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            str(time),
            "-i",
            d / "render.mp4",
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
    return np.asarray(Image.open(io.BytesIO(png)).convert("L"))


before, singing, finished = map(frame, [4.55, 4.85, 5.15])
changed = (finished.astype(float) - before) > 70
assert changed.sum() > 400, "Sung word was never highlighted"
delta = singing.astype(float) - before
assert 0.25 < (delta[changed] > 70).mean() < 0.75, "Missing progressive word sweep"
ys, xs = np.where(changed)
assert xs[delta[ys, xs] > 70].mean() < xs.mean(), "Highlight moved the wrong way"
assert (frame(11.5) > 190).sum() > 20000, "Missing bright closing artwork"
print("Independent song rendered with a left-to-right word sweep and cover fade.")
