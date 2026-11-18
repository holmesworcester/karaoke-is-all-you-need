import json, hashlib
from align import rows

v = json.load(open("vocaltimes.json"))
c = json.load(open("cleantimes.json"))
for i in range(len(v)):
    for j, w in enumerate(v[i]):
        if 25 <= i <= 32:
            v[i][j] = c[i][j]
        elif abs(w[0] - c[i][j][0]) < 0.10:
            w[0] = 0.65 * w[0] + 0.35 * c[i][j][0]
            if abs(w[1] - c[i][j][1]) < 0.13:
                w[1] = 0.65 * w[1] + 0.35 * c[i][j][1]


def setword(i, j, s, e):
    v[i][j] = [s, e, 1]


# Distinguish sung fragments from delayed echoes in the instrumental breaks.
setword(24, 2, 64.125, 64.42)
setword(24, 3, 64.62, 64.99)
setword(42, 2, 109.40, 109.72)
setword(42, 3, 109.96, 110.18)
setword(42, 4, 110.26, 110.56)
for j, (s, e) in enumerate([(136.16, 136.45), (136.47, 136.70), (136.92, 137.77)]):
    setword(44, j, s, e)
for j, (s, e) in enumerate([(137.89, 138.17), (138.22, 138.47), (138.52, 139.10)]):
    setword(45, j, s, e)
setword(46, 0, 139.22, 139.84)
setword(46, 1, 140.10, 140.92)
# Late loops are re-edits of the same source sample. The five-beat pattern was
# independently located with normalized correlation against neighbouring loops.
beat = 60 / 106
for i in range(83, 89):
    for j, w in enumerate(v[i]):
        if i == 88 and j >= 6:
            continue
        off = [0, 0.103, 0.239, 0.522, 0.806, 1.084][j % 6] + (j // 6) * 2.5 * beat
        s = 236.04 + (i - 83) * 5 * beat + off
        v[i][j] = [s, s + [0.09, 0.127, 0.245, 0.246, 0.247, 0.29][j % 6], 1]
for j, w in enumerate(v[81]):
    w[0] = 228.968 + [0, 0.10, 0.24, 0.52, 0.80, 1.132, 1.232, 1.372, 1.652, 1.932][j]
    w[1] = w[0] + [0.09, 0.128, 0.24, 0.24, 0.27][j % 5]
for j, (s, e) in enumerate([(233.735, 233.985), (234.015, 234.265), (234.295, 234.59)]):
    setword(82, j, s, e)
# CD+G time zero is the decoded backing's time zero. The per-token offset
# accounts for the window centre and acoustic emissions after consonant attack.
items = [(i, j, w) for i, row in enumerate(v) for j, w in enumerate(row)]
times = [[] for _ in rows]
for k, (i, j, (a, b, score)) in enumerate(items):
    s = round((a - 0.024) * 1000)
    nx = round((items[k + 1][2][0] - 0.024) * 1000) if k + 1 < len(items) else 256545
    if nx <= s:
        raise ValueError((i, j, s, nx))
    e = min(nx, round((b + 0.04) * 1000))
    if nx - e <= 82:
        e = nx
    e = max(s + 10, e)
    times[i].append([s, e])
json.dump(times, open("timing.json", "w"), separators=(",", ":"))
words = [w for _, w in rows]
digest = hashlib.sha256(
    json.dumps(words, separators=(",", ":"), ensure_ascii=False).encode()
).hexdigest()
print(sum(map(len, times)), digest, times[0][0], times[90][-1])
open("wordhash", "w").write(digest)
