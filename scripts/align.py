"""Force-align English LRC words to an audio recording using a wav2vec2 CTC model."""

import argparse
import json
import re
import subprocess
from pathlib import Path

import numpy as np
from scipy.special import log_softmax


def read_lrc(text):
    rows = []
    for line in text.splitlines():
        match = re.fullmatch(r"\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)", line.strip())
        if match:
            seconds = 60 * int(match[1]) + float(match[2])
            if rows and seconds < rows[-1][0]:
                raise ValueError("LRC anchors must be in chronological order")
            rows.append((seconds, match[3].split()))
    if not any(words for _, words in rows):
        raise ValueError("No timed words found in the LRC")
    return rows


def infer(audio, model):
    import onnxruntime as ort

    raw = subprocess.check_output(
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
            "16000",
            "-f",
            "f32le",
            "-",
        ]
    )
    samples = np.frombuffer(raw, dtype="<f4")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 5
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])
    chunks = []
    for start in range(0, len(samples), 160000):
        lo = max(0, start - 32000)
        clip = samples[lo : start + 192000]
        clip = (clip - clip.mean()) / np.sqrt(clip.var() + 1e-7)
        frames = session.run(None, {"input_values": clip[None]})[0][0]
        offset = (start - lo) // 320
        chunks.append(frames[offset : offset + 500])
    return log_softmax(np.concatenate(chunks), axis=1)


def automatic_segments(rows, duration):
    """Split at long instrumental gaps, where a blank CTC path dominates."""
    active = [i for i, (_, words) in enumerate(rows) if words]
    groups = [[active[0]]]
    for i in active[1:]:
        if rows[i][0] - rows[groups[-1][-1]][0] > 12:
            groups.append([])
        groups[-1].append(i)
    return [
        (g[0], g[-1], max(0, rows[g[0]][0] - 3), min(duration, rows[g[-1]][0] + 12)) for g in groups
    ]


def align(emissions, rows, vocab, segments):
    result = [[None for _ in words] for _, words in rows]
    blank = vocab["<pad>"]
    for first, last_row, start, end in segments:
        left, right = round(start * 50), round(end * 50)
        if not (0 <= first <= last_row < len(rows) and 0 <= left < right <= len(emissions)):
            raise ValueError(f"Invalid segment {first, last_row, start, end}")
        words = [
            (i, j, word) for i in range(first, last_row + 1) for j, word in enumerate(rows[i][1])
        ]
        if not words:
            continue
        ids, owners, targets, anchored = [], [], [], []
        for index, (i, j, word) in enumerate(words):
            spelling = re.sub("[^A-Z']", "", word.upper().replace("’", "'").replace("‘", "'"))
            if not spelling or any(c.isdigit() for c in word):
                raise ValueError(f"Write out the sung pronunciation of {word!r} in row {i}")
            for k, ch in enumerate(spelling):
                ids.append(vocab[ch])
                owners.append(index)
                targets.append(rows[i][0])
                anchored.append(j == 0 and k == 0)
            if index + 1 < len(words):
                ids.append(vocab["|"])
                owners.append(-1)
                targets.append(rows[i][0])
                anchored.append(False)

        seq = np.full(2 * len(ids) + 1, blank, np.int32)
        seq[1::2] = ids
        line_times = np.r_[targets[0], np.repeat(targets, 2)]
        anchor = np.zeros_like(seq, dtype=bool)
        anchor[1::2] = anchored
        owner = np.full_like(seq, -1)
        owner[1::2] = owners
        probs = emissions[left:right]
        previous = np.full(len(seq), -np.inf, np.float32)
        previous[0] = 0
        backtrack = np.zeros((len(probs), len(seq)), np.uint8)
        transitions = np.full((3, len(seq)), -np.inf, np.float32)
        can_skip = (seq[2:] != seq[:-2]) & (seq[2:] != blank)
        for frame, log_probs in enumerate(probs):
            seconds = left / 50 + (frame + 0.5) / 50
            transitions[0] = previous
            transitions[1, 1:] = previous[:-1]
            transitions[2, 2:] = np.where(can_skip, previous[:-2], -np.inf)
            backtrack[frame] = transitions.argmax(0)
            # Soft line-start priors protect repeated lines from migrating to adjacent repetitions.
            distance = abs(seconds - line_times)
            penalty = np.maximum(distance - 0.22, 0) ** 1.5 * 3.7 * anchor
            previous = transitions.max(0) + log_probs[seq] - penalty
            previous[(distance > 12) & (seq != blank)] = -np.inf

        pos = len(seq) - (1 if previous[-1] >= previous[-2] else 2)
        if not np.isfinite(previous[pos]):
            raise ValueError(
                f"No complete CTC path for rows {first}–{last_row}. Check anchors and words."
            )
        states = np.empty(len(probs), np.int32)
        for frame in range(len(probs) - 1, -1, -1):
            states[frame] = pos
            pos -= int(backtrack[frame, pos])
        active = owner[states]
        for index, (i, j, _) in enumerate(words):
            frames = np.flatnonzero(active == index)
            if result[i][j] is not None:
                raise ValueError(f"Overlapping segments include row {i}")
            confidence = np.exp(probs[frames, seq[states[frames]]]).mean()
            result[i][j] = [
                round(left / 50 + frames[0] / 50 + 0.0125, 3),
                round(left / 50 + frames[-1] / 50 + 0.0325, 3),
                float(confidence),
            ]
    if any(None in row for row in result):
        raise ValueError("Segments must cover every nonempty lyric row")
    return result


def intervals(raw, duration):
    result = [[] for _ in raw]
    words = [(i, a, b) for i, row in enumerate(raw) for a, b, _ in row]
    starts = [max(0, round((a - 0.024) * 1000)) for _, a, _ in words]
    for (i, _, b), start, following in zip(words, starts, starts[1:] + [round(duration * 1000)]):
        end = min(round((b + 0.04) * 1000), following)
        if following - end <= 82:
            end = following
        if end <= start:
            raise ValueError(f"Overlapping word onsets in row {i}. Review the segment boundaries.")
        result[i].append([start, end])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("lrc", type=Path)
    parser.add_argument("models", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--segments", type=Path, help="JSON array of [firstRow,lastRow,startSec,endSec]"
    )
    parser.add_argument(
        "--raw-output", type=Path, help="Write seconds and confidence for listening review"
    )
    args = parser.parse_args()
    rows = read_lrc(args.lrc.read_text())
    vocab = json.loads((args.models / "vocab.json").read_text())
    scores = infer(args.audio, args.models / "align.onnx")
    duration = len(scores) / 50
    segments = (
        json.loads(args.segments.read_text())
        if args.segments
        else automatic_segments(rows, duration)
    )
    raw = align(scores, rows, vocab, segments)
    result = intervals(raw, duration)
    if args.raw_output:
        args.raw_output.write_text(json.dumps(raw))
    args.output.write_text(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
