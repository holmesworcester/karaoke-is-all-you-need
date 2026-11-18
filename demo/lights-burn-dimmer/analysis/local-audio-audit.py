import numpy as np, json, subprocess
from scipy import signal
from scipy.io import wavfile
from matches import ncc

cues = json.load(open("timing.json"))
sr, studio = wavfile.read("studio.wav")
wave = np.frombuffer(
    subprocess.check_output(
        ["ffmpeg", "-v", "error", "-i", "sing.mp3", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]
    ),
    "<f4",
)
checks = []
for at in [2, 8, 15, 30, 45, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 255]:
    i = int(at * sr)
    span = 2 * sr
    query = studio[i : i + span]
    win = wave[i - sr // 2 : i + span + sr // 2]
    cp = signal.correlate(win, query, "valid", method="fft")
    k = cp.argmax()
    checks.append(
        [
            at,
            round((k - sr // 2) * 1000 / sr, 2),
            round(float(cp[k] / (np.linalg.norm(query) * np.linalg.norm(win[k : k + span]))), 3),
        ]
    )
# Hold out actual recurring audio, find the peak waveform match without referring
# to the target's word timestamps, and only accept an unambiguous acoustic match.
landmarks = []
for ref, target, expected in [
    (4, 8, 16 * 60 / 106),
    (4, 16, 48 * 60 / 106),
    (4, 20, 64 * 60 / 106),
    (12, 13, 4 * 60 / 106),
    (12, 14, 8 * 60 / 106),
    (84, 85, 5 * 60 / 106),
    (84, 86, 10 * 60 / 106),
    (84, 87, 15 * 60 / 106),
]:
    for j, (ms, _) in enumerate(cues[ref]):
        a = ms / 1000
        guess = a + expected
        for shift in [0.0, 0.028]:
            sc = ncc(a, shift, 0.125, guess - 0.20, guess + 0.20)
            peak = int(sc.argmax())
            strength = float(sc[peak])
            s = guess - 0.20 + peak / 16000
            if strength > 0.61:
                landmarks.append([target, j, round(s * 1000), round(strength, 2)])
                break
d = [abs(cues[i][j][0] - t) for i, j, t, q in landmarks]
print("Audio alignment", checks)
print("landmarks", len(d), "median/p95/max ms", np.percentile(d, [50, 95, 100]))
if max(abs(x[1]) for x in checks) > 5 or len(d) < 30 or np.percentile(d, 95) > 75:
    raise ValueError("Reference alignment failed")
out = {
    "waveformWindows": checks,
    "repeatedVocalLandmarks": landmarks,
    "medianLandmarkErrorMs": round(float(np.median(d)), 1),
    "p95LandmarkErrorMs": round(float(np.percentile(d, 95)), 1),
}
json.dump(out, open("acoustic-audit.json", "w"), indent=2)
