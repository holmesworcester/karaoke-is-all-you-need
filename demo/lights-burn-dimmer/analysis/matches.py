import numpy as np, json
from scipy import signal
from scipy.io import wavfile

sr, y = wavfile.read("vocal.wav")
y = signal.sosfilt(signal.butter(4, [200, 3800], fs=sr, btype="bandpass", output="sos"), y)
v = json.load(open("vocaltimes.json"))


def ncc(ref, tt, du, lo, hi):
    s = round((ref + tt) * sr)
    length = round(du * sr)
    tx = y[s : s + length]
    seg = y[round((lo + tt) * sr) : round((hi + tt) * sr) + length]
    scores = signal.correlate(seg, tx, "valid", method="fft") / np.sqrt(
        np.maximum(1e-15, np.dot(tx, tx) * signal.fftconvolve(seg * seg, np.ones(length), "valid"))
    )
    return scores


if __name__ == "__main__":
    lo = 228.4
    hi = 236.04
    for j in range(6):
        scores = np.stack([ncc(v[r][j][0], 0, 0.13, lo, hi) for r in [84, 85, 86]])
        # local maximum within 20ms for each reference aligner error before pooling
        from scipy.ndimage import maximum_filter1d

        q = np.median(maximum_filter1d(scores, size=321, axis=1), axis=0)
        peaks = signal.find_peaks(q, distance=int(0.14 * sr), height=0.45)[0]
        print(j, [(round(lo + k / sr, 2), round(q[k], 2)) for k in peaks if q[k] > 0.47])
