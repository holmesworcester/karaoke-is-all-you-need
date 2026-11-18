from pathlib import Path
import sys, subprocess as sp, json
import numpy as np
from PIL import Image
from scipy.signal import correlate
import base64, re

movie, player, qc = map(Path, sys.argv[1:])
src = qc / "player-backing.mp3"
audio_tag = re.search(r'<script id="sound"[^>]*>([^<]+)</script>', player.read_text())
src.write_bytes(base64.b64decode(audio_tag[1]))
s = json.loads((qc / "samples.json").read_text())


def probe(*args):
    return json.loads(sp.check_output(["ffprobe", "-v", "error", *args, "-of", "json", movie]))


streams = probe("-show_streams")["streams"]
v, a = streams
assert (v["width"], v["height"], v["codec_name"], v["pix_fmt"], v["r_frame_rate"]) == (
    1920,
    1080,
    "h264",
    "yuv420p",
    "60/1",
)
assert (a["codec_name"], a["channels"], a["sample_rate"]) == ("aac", 2, "44100")
assert float(v["start_time"]) == float(a["start_time"]) == 0
assert abs(float(v["duration"]) - float(a["duration"])) < 1 / 60
assert abs(float(a["duration"]) - 263.87932) < 0.002
packets = probe("-select_streams", "v", "-show_packets", "-show_entries", "packet=pts,dts")[
    "packets"
]
assert len(packets) == 15833 and v["time_base"] == "1/60000"
assert sorted(int(p["pts"]) for p in packets) == list(range(0, 15833000, 1000))
assert all(int(x["dts"]) < int(y["dts"]) for x, y in zip(packets, packets[1:]))
test = "+".join("eq(n," + str(e["frame"]) + ")" for e in s)
sp.run(
    [
        "ffmpeg",
        "-nostdin",
        "-xerror",
        "-loglevel",
        "error",
        "-y",
        "-threads",
        "5",
        "-i",
        str(movie),
        "-map",
        "0:v:0",
        "-vf",
        "select='" + test + "'",
        "-fps_mode",
        "passthrough",
        "-threads",
        "2",
        str(qc / "encoded%03d.png"),
    ],
    check=True,
)
all_rms = []
glyph_rms = []
bad = []
for i, e in enumerate(s, 1):
    ref = np.asarray(Image.open(qc / f"ref{i:03d}.png").convert("L")).astype(np.float32)
    enc = np.asarray(Image.open(qc / f"encoded{i:03d}.png").convert("L")).astype(np.float32)
    err = (ref - enc) ** 2
    all_rms.append(float(np.sqrt(err.mean())))
    for x, y, r, b in e["active"]:
        glyph_rms.append(float(np.sqrt(err[y:b, x:r].mean())))
    if all_rms[-1] > 1.8 or any(
        float(np.sqrt(err[y:b, x:r].mean())) > 4.0 for x, y, r, b in e["active"]
    ):
        bad.append([e["time"], round(all_rms[-1], 2)])
assert not bad, bad


def audio(path):
    return np.frombuffer(
        sp.check_output(
            [
                "ffmpeg",
                "-nostdin",
                "-xerror",
                "-v",
                "error",
                "-i",
                str(path),
                "-map",
                "0:a:0",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "f32le",
                "-",
            ]
        ),
        dtype="<f4",
    )


ref = audio(src)
mov = audio(movie)
lags = []
scores = []
for t in [2, 8, 30, 60, 100, 140, 180, 220, 255]:
    i = t * 16000
    n = 32000
    half = 3200
    clip = ref[i : i + n]
    window = mov[i - half : i + n + half]
    c = correlate(window, clip, mode="valid", method="fft")
    k = int(np.argmax(c))
    lags.append((k - half) / 16)
    scores.append(float(c[k] / (np.linalg.norm(clip) * np.linalg.norm(window[k : k + n]))))
assert max(map(abs, lags)) <= 2 and min(scores) > 0.97, (lags, scores)
print(
    json.dumps(
        dict(
            frames=len(packets),
            videoDuration=v["duration"],
            audioDuration=a["duration"],
            decodedImageChecks=len(s),
            activeWordRegions=len(glyph_rms),
            maxImageRms=round(max(all_rms), 2),
            maxGlyphRms=round(max(glyph_rms), 2),
            audioWindowOffsetsMs=lags,
            minAudioCorrelation=round(min(scores), 5),
        ),
        indent=2,
    )
)
