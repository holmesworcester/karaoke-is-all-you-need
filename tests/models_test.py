"""Run both ONNX models on an audible, known-time synthetic vocal entrance."""

import json
import subprocess as sp
import sys
from pathlib import Path
import numpy as np
from scipy.io import wavfile

d = Path("build/model-test")
models = Path(sys.argv[1])
d.mkdir(parents=True, exist_ok=True)
sp.run(
    [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "flite=text='hello world':voice=slt",
        "-af",
        "adelay=3000:all=1,apad",
        "-t",
        "7",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "pcm_f32le",
        d / "voice.wav",
    ],
    check=True,
)
sp.run(
    [sys.executable, "scripts/separate.py", d / "voice.wav", models / "separator.onnx", d],
    check=True,
)
_, voice = wavfile.read(d / "voice.wav")
sr, backing = wavfile.read(d / "instrumental.wav")
_, stem = wavfile.read(d / "clean-vocal.wav")
assert backing.shape == voice.shape and len(stem) == len(voice) and sr == 44100
assert np.allclose((voice - backing * 1.022).mean(axis=1), stem, atol=1e-5)
(d / "words.lrc").write_text("[00:03.00] Hello world")
sp.run(
    [
        sys.executable,
        "scripts/align.py",
        d / "clean-vocal.wav",
        d / "words.lrc",
        models,
        d / "timing.json",
    ],
    check=True,
)
(a, b), (c, e) = json.loads((d / "timing.json").read_text())[0]
assert 2950 <= a < 3300 and a < b <= c < e < 4100, [a, b, c, e]
print("Separated stereo track and aligned the two-word entrance at", a, "ms")
