"""Estimate sustained word releases from a vocal stem and an existing word timing table."""

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy import ndimage, signal

RATE = 16000
HOP = 160
WINDOW = 1024
FFT = 2048
# Log-frequency bins let all partials follow the same pitch bend.
BINS_PER_OCTAVE = 96
FREQ = 90 * 2 ** (np.arange(576) / BINS_PER_OCTAVE)


def vocal_spectrum(audio):
    pcm = subprocess.check_output(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(audio),
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            str(RATE),
            "-f",
            "f32le",
            "-",
        ]
    )
    samples = np.frombuffer(pcm, dtype="<f4")
    padded = np.pad(samples, WINDOW // 2)
    frames = np.lib.stride_tricks.sliding_window_view(padded, WINDOW)[::HOP]
    window = signal.windows.hann(WINDOW, sym=False)
    pos = FREQ * FFT / RATE
    left = pos.astype(int)
    frac = pos - left
    spec = np.empty((len(frames), len(pos)), np.float32)
    for i in range(0, len(frames), 512):
        mag = abs(np.fft.rfft(frames[i : i + 512] * window, n=FFT, axis=1)) / (
            window.sum() / 2
        )
        projected = mag[:, left] * (1 - frac) + mag[:, left + 1] * frac
        spec[i : i + len(mag)] = 20 * np.log10(np.maximum(projected, 1.0e-6))
    return spec


def tonal_template(spec, center):
    # Stable partials over 50 ms reject most plosives, sibilants and breaths.
    patch = spec[max(0, center - 2) : center + 3]
    if len(patch) != 5:
        return None
    level = np.median(patch, axis=0)
    peaks, _ = signal.find_peaks(level, prominence=8, distance=7)
    peaks = peaks[(FREQ[peaks] >= 180) & (FREQ[peaks] <= 3300)]
    if len(peaks) < 2:
        return None
    peaks = peaks[
        (level[peaks] > max(-52, level[peaks].max() - 20))
        & (np.ptp(patch[:, peaks], axis=0) < 12)
    ]
    if len(peaks) < 2:
        return None
    peaks = peaks[np.argsort(level[peaks])[-5:]]
    return peaks, level[peaks]


def track(spec, wide, center, limit):
    template = tonal_template(spec, center)
    if template is None:
        return None
    peaks, reference = template
    # Require a majority of the original partials, including at least two.
    required = max(2, (len(peaks) + 1) // 2)
    shifts = np.arange(-12, 13)
    patch = wide[center : limit + 1, peaks[:, None] + shifts]
    relative = np.clip(patch - reference[None, :, None], -65, 8)
    strength = 0.45 * np.sort(relative, axis=1)[:, -required, :] + 0.55 * np.average(
        relative, axis=1, weights=10 ** ((reference - reference.max()) / 17)
    )
    level = np.empty(len(strength))
    shift = len(shifts) // 2
    for i, scores in enumerate(strength):
        lo, hi = max(0, shift - 2), min(len(shifts), shift + 3)
        shift = lo + np.argmax(
            scores[lo:hi]
            - 0.4 * abs(np.arange(lo, hi) - shift)
            - 0.12 * abs(shifts[lo:hi])
        )
        level[i] = scores[shift]
    level = ndimage.median_filter(level, size=5, mode="nearest")
    # A soft attack can grow into a strong vowel; measure subsequent decay from
    # the stable level reached by the note rather than the quiet initial frame.
    return level - np.maximum.accumulate(
        np.maximum(0, ndimage.median_filter(level, size=15, mode="nearest"))
    )


def release_frame(level, center, threshold):
    # A 60-ms interruption ends the note at the beginning of that interruption.
    bad = np.convolve((level < threshold).astype(int), np.ones(6, int), mode="valid")
    hits = np.flatnonzero(bad == 6)
    return center + (int(hits[0]) if len(hits) else len(level) - 1)


def propose(spec, timing):
    wide = ndimage.maximum_filter1d(spec, size=5, axis=1, mode="nearest")
    words = [
        (r, j, a, b) for r, row in enumerate(timing) for j, (a, b) in enumerate(row)
    ]
    previous = 0
    for _, _, start, end in words:
        if not (
            isinstance(start, int)
            and isinstance(end, int)
            and previous <= start < end <= len(spec) * 10 + 5
        ):
            raise ValueError(
                "Word intervals must be chronological integer milliseconds on the vocal clock"
            )
        previous = end
    output = []
    for k, (r, j, a, b) in enumerate(words):
        following = words[k + 1][2] if k + 1 < len(words) else (len(spec) - 1) * 10
        if following - b < 120:
            continue
        end = round(b / 10)
        limit = min(len(spec) - 1, following // 10, end + 600)
        if limit - end < 12:
            continue
        predictions = []
        local = spec[max(0, end - 14) : min(len(spec), end + 22)]
        loudest = local.max()
        # Include nearby frames just beyond a CTC spike: a fricative may be the
        # last recognized character while the stressed vowel is only beginning.
        for center in range(
            max(2, round(a / 10) + 2, end - 13), min(end + 20, limit - 11) + 1, 3
        ):
            if center > end and spec[end : center + 1].max(axis=1).min() < -48:
                break
            if np.median(spec[center - 2 : center + 3].max(axis=1)) < loudest - 9:
                continue
            level = track(spec, wide, center, limit)
            if level is None:
                continue
            releases = [
                release_frame(level, center, threshold) for threshold in (-10, -13, -16)
            ]
            if releases[1] - center >= 15:
                predictions.append(releases)
        if not predictions:
            continue
        offsets = np.array(predictions) * 10
        estimate = int(np.median(offsets[:, 1]))
        if estimate - b < 120:
            continue
        low, high = np.percentile(offsets[:, 0], 25), np.percentile(offsets[:, 2], 75)
        capped = estimate >= 10 * limit - 20
        output.append(
            dict(
                row=r,
                word=j,
                startMs=a,
                oldEndMs=b,
                endMs=min(estimate, following),
                lowerMs=int(low),
                upperMs=int(high),
                seeds=len(predictions),
                capped=capped,
                consensus=not capped
                and len(predictions) >= 4
                and bool(high - low <= 150)
                and bool(low >= b + 100),
            )
        )
    return output


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("vocal", type=Path)
    p.add_argument("timing", type=Path)
    p.add_argument("report", type=Path)
    p.add_argument(
        "--output",
        type=Path,
        help="Write timings with only uncapped, agreeing release estimates applied",
    )
    args = p.parse_args()
    timing = json.loads(args.timing.read_text())
    result = propose(vocal_spectrum(args.vocal), timing)
    args.report.write_text(json.dumps(result, indent=2) + "\n")
    if args.output:
        for proposal in result:
            if proposal["consensus"]:
                timing[proposal["row"]][proposal["word"]][1] = proposal["endMs"]
        args.output.write_text(json.dumps(timing, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
