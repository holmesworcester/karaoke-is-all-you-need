"""Measure a word's highlight in a finished video using its ASS glyphs as a mask."""
import argparse
import json
import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np


def seconds(ass_time):
    hours, minutes, rest = ass_time.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(rest)


def mask_dialogue(script, word, moment, lane):
    lines = script.splitlines()
    header = []
    matches = []
    for line in lines:
        if not line.startswith("Dialogue:"):
            header.append(line)
            continue
        fields = line.split(",", 9)
        if not seconds(fields[1]) <= moment < seconds(fields[2]) or (lane and fields[4] != lane):
            continue
        parts = re.split(r"(\{[^}]*\})", fields[9])
        if sum(text.strip() == word for text in parts) != 1:
            continue
        masked = []
        for text in parts:
            if text.startswith("{") or not text:
                masked.append(text)
            elif text.strip() == word:
                masked.append(r"{\alpha&H00&\1c&HFFFFFF&\2c&HFFFFFF&\bord0\shad0}" + text)
            else:
                masked.append(r"{\alpha&HFF&}" + text)
        matches.append(",".join(fields[:9] + ["".join(masked)]))
    if len(matches) != 1:
        raise ValueError("Choose a unique active karaoke word and lane at the supplied time")
    return "\n".join(header + matches) + "\n"


def gray_frame(arguments, width, height, cwd=None):
    raw = subprocess.check_output([
        "ffmpeg", "-nostdin", "-loglevel", "error", "-threads", "2", *arguments,
        "-frames:v", "1", "-threads:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ], cwd=cwd)
    return np.frombuffer(raw, np.uint8).reshape(height, width)


def check(movie, subtitles, word, start, end, *, lane=None, fonts=None, clock_offset=0, threshold=200):
    if end <= start or start < clock_offset:
        raise ValueError("The word needs a positive interval on the video clock")
    probe = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
        "-of", "json", movie,
    ])
    video = json.loads(probe)["streams"][0]
    width, height = video["width"], video["height"]
    middle = (start + end) / 2
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "mask.ass").write_text(mask_dialogue(subtitles.read_text(), word, middle, lane))
        style = "ass=mask.ass"
        if fonts:
            (root / "fonts").symlink_to(fonts.resolve(), target_is_directory=True)
            style += ":fontsdir=fonts"
        mask = gray_frame([
            "-f", "lavfi", "-i", f"color=black:size={width}x{height}",
            "-vf", f"setpts=PTS+{middle:.6f}/TB,{style},format=gray",
        ], width, height, root) > 235
    if mask.sum() < 16:
        raise ValueError("Too few solid glyph pixels to measure")
    coverage = []
    for position in (0.12, 0.86):
        time = start + position * (end - start) - clock_offset
        pixels = gray_frame(["-ss", f"{time:.6f}", "-i", movie, "-map", "0:v:0"], width, height)
        coverage.append(round(float(np.mean(pixels[mask] > threshold)), 3))
    return coverage


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("movie", type=Path)
    parser.add_argument("subtitles", type=Path)
    parser.add_argument("word")
    parser.add_argument("start", type=float, help="Word start in seconds on the subtitle clock")
    parser.add_argument("end", type=float)
    parser.add_argument("--lane", help="ASS Name field for simultaneous voices")
    parser.add_argument("--fonts", type=Path)
    parser.add_argument("--clock-offset", type=float, default=0, help="Subtitle clock at video time zero")
    parser.add_argument("--threshold", type=int, default=200, help="Brightness between unsung and sung colors")
    options = parser.parse_args()
    coverage = check(**vars(options))
    print(json.dumps({"early": coverage[0], "late": coverage[1]}))
    if coverage[1] - coverage[0] <= 0.37:
        raise SystemExit("The exported word did not brighten through its interval")
