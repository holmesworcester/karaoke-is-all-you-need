import assert from 'node:assert/strict';
export function verifyPackets(data, markers, offset = () => 0) {
  const image = new Uint8Array(300 * 216);
  const events = markers
    .flatMap(({ p, t, id }) =>
      [
        [-0.018, 1],
        [0.033, 2],
      ].map(([d, expect]) => ({ frame: Math.floor((t + d + offset(t)) * 300), p, expect, id }))
    )
    .sort((a, b) => a.frame - b.frame);
  let frame = -1;
  const mistakes = [];
  for (const e of events) {
    while (frame < e.frame) {
      const pos = ++frame * 24;
      if ((data[pos] & 63) !== 9) continue;
      const op = data[pos + 1] & 63;
      if (op === 1) {
        image.fill(data[pos + 4] & 15);
        continue;
      }
      if (op !== 6 && op !== 38) continue;
      const x0 = (data[pos + 7] & 63) * 6,
        y0 = (data[pos + 6] & 31) * 12;
      assert.ok(x0 + 5 < 300 && y0 + 11 < 216);
      for (let y = 0; y < 12; y++)
        for (let x = 0; x < 6; x++) {
          const k = (y0 + y) * 300 + x0 + x;
          const col = data[pos + 4 + ((data[pos + 8 + y] >> (5 - x)) & 1)] & 15;
          image[k] = op === 38 ? image[k] ^ col : col;
        }
    }
    const actual = image[e.p[1] * 300 + e.p[0]];
    if (actual !== e.expect) mistakes.push([e.id, e.expect, actual, e.p]);
  }
  return mistakes;
}
