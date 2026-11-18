"""Replay the studio edition's manually bounded CTC passes in a scratch directory."""

import importlib.util
import json
from pathlib import Path
import numpy as np

core = Path(__file__).resolve().parents[3] / "scripts" / "align.py"
spec = importlib.util.spec_from_file_location("ctc", core)
ctc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctc)
rows = ctc.read_lrc(json.loads(Path("lrc-ref.json").read_text())["syncedLyrics"])
vocab = json.loads(Path("vocab.json").read_text())
segments = [[0, 24, 3.3, 65.7], [25, 42, 65.7, 111.4], [44, 46, 132, 145], [47, 90, 150, 258.9]]


def gettimes(emissions, output):
    Path(output).write_text(json.dumps(ctc.align(emissions, rows, vocab, segments)))


if __name__ == "__main__":
    for name in ["vocal", "mix", "clean"]:
        source = Path(name + "-emit.npy")
        if source.exists():
            gettimes(np.load(source), name + "times.json")
