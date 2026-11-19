"""Exercise held notes, decays, silence, re-attacks and a following word on the real audio path."""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

d = Path("build/release-test")
d.mkdir(parents=True, exist_ok=True)
sr = 16000
time = np.arange(8 * sr) / sr
y = np.zeros_like(time)


def voice(start, end, hz, gain=1):
    t = time - start
    phase = 2 * np.pi * hz * t + 0.22 * np.sin(2 * np.pi * 5 * t)
    wave = (
        np.sin(phase)
        + 0.55 * np.sin(2 * phase)
        + 0.38 * np.sin(3 * phase)
        + 0.25 * np.sin(4 * phase)
    ) / 4
    env = np.clip(t / 0.022, 0, 1) * np.clip((end - time) / 0.035, 0, 1)
    return wave * env * gain


# Deliberately leave a quiet other singer under the release, then repeat loudly after silence.
y += voice(0.3, 1.73, 280) + voice(1.1, 2.1, 389, 0.08) + voice(1.99, 2.3, 280, 0.38)
# A true release with a quiet echo separated from the word.
y += voice(3.0, 3.46, 375) + voice(3.66, 3.89, 375, 0.2)
# A same-pitch following syllable is indistinguishable. The interval must respect its onset.
y += voice(4.2, 5.5, 315)
# An unvoiced ending and an unrelated delayed note should stay separate.
rng = np.random.default_rng(42)
y += voice(6.0, 6.25, 230)
y[(time >= 6.25) & (time < 6.44)] += rng.normal(
    0, 0.025, ((time >= 6.25) & (time < 6.44)).sum()
)
y += voice(6.72, 7.3, 415)
wavfile.write(d / "voice.wav", sr, y.astype(np.float32))
original = [
    [[300, 820]],
    [],
    [[3000, 3450]],
    [[4200, 4480], [4750, 5500]],
    [[6000, 6440]],
]
(d / "source.json").write_text(json.dumps(original))
subprocess.run(
    [
        sys.executable,
        "scripts/refine_releases.py",
        d / "voice.wav",
        d / "source.json",
        d / "report.json",
        "--output",
        d / "out.json",
    ],
    check=True,
)
out = json.loads((d / "out.json").read_text())
report = json.loads((d / "report.json").read_text())
assert abs(out[0][0][1] - 1730) < 65, (out, report)
assert out[1:] == original[1:], (out, report)
assert all(i["endMs"] <= 4750 for i in report if i["row"] == 3 and i["word"] == 0)
assert out[0][0][0] == original[0][0][0]
print(
    "Held vowel extended to the measured release; echo, unvoiced ending and adjacent word stayed separate."
)
