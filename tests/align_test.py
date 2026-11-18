"""A repeated CTC letter needs a blank frame, and the next line must survive a long silence."""

import sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from align import align, automatic_segments, intervals, read_lrc

vocab = {"<pad>": 0, "A": 1, "L": 2, "G": 3, "O": 4, "|": 5}
rows = read_lrc("[ar:Example]\n[00:01.00] All\n[00:06.00]\n[00:16.00] Go")
em = np.full((1000, 6), -12.0, dtype=np.float32)
em[:, 0] = 0
for frame, letter in [(50, "A"), (52, "L"), (55, "L"), (800, "G"), (805, "O")]:
    em[frame, 0], em[frame, vocab[letter]] = -12.0, 0.0
raw = align(em, rows, vocab, automatic_segments(rows, 20))
assert np.allclose(raw[0][0], [1.012, 1.132, 1], atol=0.0011)
assert np.allclose(raw[2][0], [16.012, 16.132, 1], atol=0.0011)
times = intervals(raw, 20)
assert times[1] == [] and times[0][0][1] < 1200 < 15900 < times[2][0][0]
try:
    align(em[:2], rows, vocab, [[0, 0, 0, 0.04]])
except ValueError as error:
    assert "No complete CTC path" in str(error)
else:
    raise AssertionError("Alignment accepted an impossible path")
print("Repeated letter, long rest, empty row, and impossible CTC path checked.")
