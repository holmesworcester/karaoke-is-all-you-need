// CD+G runs at 300 packets per second. Reserve the time-critical sweeps first,
// then fit the independent preview tiles into the free slots ahead of the voice.
export function compile(words, timing, art, duration, { bpm = 120, pickupRows = [] } = {}) {
  const count = Math.ceil(duration * 300),
    data = new Uint8Array(count * 24);
  const high = [],
    low = [],
    pages = [];
  const packet = (opcode, bytes) => [9, opcode, 0, 0, ...bytes];
  const at = (sec, p) => high.push({ tick: Math.max(0, Math.round(sec * 300)), p });
  const batch = (start, deadline, packets) =>
    low.push({ start: Math.max(0, Math.ceil(start * 300)), deadline: Math.floor(deadline * 300), packets });
  const tile = (op, x, y, a, b, mask) => packet(op, [a, b, y, x, ...mask]);
  function palette(sec, hex, factor = 1) {
    const values = hex
      .map((s) => s.match(/../g).map((c) => Math.round((parseInt(c, 16) * factor) / 17)))
      .map(([r, g, b]) => (r << 8) | (g << 4) | b);
    for (let i = 0; i < 2; i++)
      at(
        sec + i / 300,
        packet(
          30 + i,
          values.slice(i * 8, i * 8 + 8).flatMap((n) => [n >> 6, n & 63])
        )
      );
  }
  function solid(asset, clear = false) {
    return asset.flatMap(([x, y, planes]) =>
      clear
        ? [tile(6, x, y, 0, 0, Array(12).fill(0))]
        : planes.map(([bit, ...mask], i) => tile(i === 0 ? 6 : 38, x, y, 0, 1 << bit, mask))
    );
  }
  const ascii = (s) => s.replace(/[’‘]/g, "'").replace(/[–—]/g, '-');
  const width = (w) => [...ascii(w)].reduce((v, c) => v + (art.atlas[c] || art.atlas['?'])[0], 0);
  const space = width(' ');
  const stringWidth = (ws) => ws.reduce((n, w) => n + w.width, 0) + (ws.length - 1) * space;
  function wrap(ws) {
    if (stringWidth(ws) <= 254) return [ws];
    let best = null,
      score = Infinity;
    for (let cut = 1; cut < ws.length; cut++) {
      const a = ws.slice(0, cut),
        b = ws.slice(cut);
      const l = stringWidth(a),
        r = stringWidth(b);
      if (Math.max(l, r) > 254) continue;
      const cost = Math.abs(l - r) - (a.at(-1).text.match(/[,?!]$/) ? 24 : 0);
      if (cost < score) {
        score = cost;
        best = [a, b];
      }
    }
    return best;
  }
  function add(ws) {
    if (!ws.length) return;
    const lines = wrap(ws);
    if (!lines && ws.length === 1) throw Error('Word is too wide for the CD+G safe area: ' + ws[0].text);
    if (!lines) {
      let cut = Math.ceil(ws.length / 2);
      add(ws.slice(0, cut));
      add(ws.slice(cut));
      return;
    }
    pages.push({ lines, words: ws, start: ws[0].start, end: ws.at(-1).end });
  }
  words.forEach((row, i) => {
    let group = [];
    row.forEach((text, j) => {
      const [a, b] = timing[i][j];
      if (group.length && a / 1000 - group.at(-1).end > 1.7) {
        add(group);
        group = [];
      }
      group.push({ text, width: width(text), start: a / 1000, end: b / 1000, id: [i, j] });
    });
    add(group);
  });
  const blank = () => Array(12).fill(0);
  function maskWord(word, x0, y0) {
    const pixels = [];
    let x = x0;
    for (const char of ascii(word.text)) {
      const [advance, rows] = art.atlas[char] || art.atlas['?'];
      rows.forEach((bits, row) => {
        for (let dx = 0; bits; bits >>>= 1, dx++) if (bits & 1) pixels.push([x + dx, y0 + row]);
      });
      x += advance;
    }
    return pixels;
  }
  for (let i = 0; i + 1 < pages.length; i++) {
    const cur = pages[i],
      next = pages[i + 1];
    if (cur.end - cur.start < 0.75 && next.start - cur.end < 0.55) {
      const ws = [...cur.words, ...next.words],
        lines = wrap(ws);
      if (lines) pages.splice(i, 2, { words: ws, lines, start: cur.start, end: next.end });
    }
  }
  const key = (x, y) => Math.floor(y / 12) * 50 + Math.floor(x / 6);
  function put(map, x, y) {
    const k = key(x, y);
    if (!map.has(k)) map.set(k, blank());
    map.get(k)[y % 12] |= 1 << (5 - (x % 6));
  }
  const from = (map, op, b) =>
    Array.from(map, ([k, mask]) => tile(op, k % 50, Math.floor(k / 50), 0, b, mask));
  palette(0, art.live);
  at(0.007, packet(1, [0, 0]));
  at(0.01, packet(2, [0]));
  batch(0.014, 0.8, solid(art.header));
  const introEnd = 2.2;
  at(introEnd, packet(1, [0, 0]));
  const laneMasks = [new Map(), new Map()];
  const cues = [],
    rests = [];
  const markers = [];
  pages.forEach((page, i) => {
    const lane = i % 2,
      old = i >= 2 ? pages[i - 2] : null,
      map = new Map();
    const prep = old ? Math.max(old.end + 0.035, page.start - 3.7) : introEnd + 0.02;
    page.enter = prep;
    page.lane = lane;
    const mid = lane ? 150 : 74;
    for (let li = 0; li < page.lines.length; li++) {
      const row = page.lines[li];
      const top = page.lines.length === 1 ? mid - 12 : mid - 24 + li * 24;
      let x = Math.floor((300 - stringWidth(row)) / 2);
      for (const word of row) {
        const pixels = maskWord(word, x, top);
        if (!pixels.length) throw Error('Empty glyph');
        const slices = new Map();
        const stride = Math.max(
          3,
          Math.ceil(word.width / Math.max(1, Math.floor((word.end - word.start) * 60)))
        );
        for (const [px, py] of pixels) {
          if (px < 12 || px >= 288 || py < 48 || py > 180) throw Error('Lyric escaped the title-safe area');
          put(map, px, py);
          const slice = Math.floor((px - x) / stride);
          if (!slices.has(slice)) slices.set(slice, new Map());
          put(slices.get(slice), px, py);
        }
        const sweeps = [...slices].sort((a, b) => a[0] - b[0]);
        const first = word.start;
        for (const [slice, m] of sweeps) {
          const t =
            first +
            ((word.end - first) * Math.max(0, slice - sweeps[0][0]) * stride) / Math.max(1, word.width);
          for (const p of from(m, 38, 3)) at(t, p);
        }
        // The probe refers to the first sweep's first actual foreground pixel.
        const pos = Math.min(...pixels.map(([px]) => Math.floor((px - x) / stride)));
        const probe = pixels.find(([px]) => Math.floor((px - x) / stride) === pos);
        markers.push({ id: word.id, t: first, end: word.end, p: probe });
        x += word.width + space;
      }
    }
    const oldMask = laneMasks[lane],
      prepare = [];
    for (const k of oldMask.keys())
      if (!map.has(k)) prepare.push(tile(6, k % 50, Math.floor(k / 50), 0, 0, blank()));
    prepare.push(...from(map, 6, 1));
    batch(prep, page.start - 0.025, prepare);
    laneMasks[lane] = map;
    const next = pages[i + 1];
    const nextLane = pages[i + 2];
    page.leave = nextLane ? Math.max(page.end + 0.035, nextLane.start - 3.7) : page.end + 0.2;
    if (!nextLane || nextLane.start - page.end > 6) {
      page.leave = page.end + 0.2;
      batch(page.end + 0.2, page.end + 0.95, from(map, 6, 0));
    }
    if (!next || next.start - page.end < 5.8) return;
    const gapStart = page.end + 0.99,
      gapEnd = next.start - 3.9;
    if (gapEnd > gapStart + 0.7) {
      rests.push([gapStart, gapEnd]);
      batch(gapStart, gapStart + 0.5, solid(art.rest));
      batch(gapEnd - 0.35, gapEnd, solid(art.rest, true));
    }
  });
  const beat = 60 / bpm,
    dotMask = [0, 0, 0, 0, 12, 30, 30, 12, 0, 0, 0, 0];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i],
      prev = pages[i - 1],
      gap = prev ? page.start - prev.end : Infinity;
    const y = page.lane ? 9 : 3;
    if (gap >= 3.5) {
      const start = page.start - 4 * beat;
      cues.push({ kind: 'count', lane: page.lane, start, end: page.start, count: 4 });
      for (let j = 0; j < 4; j++) {
        at(start, tile(6, 23 + j, y, 0, 2, dotMask));
        at(start + (j + 1) * beat, tile(6, 23 + j, y, 0, 0, dotMask));
      }
    } else if (gap >= 0.2 && page.words[0].id[1] === 0 && pickupRows.includes(page.words[0].id[0])) {
      const start = page.start - beat;
      cues.push({ kind: 'pickup', lane: page.lane, start, end: page.start, count: 3 });
      for (let j = 0; j < 3; j++) {
        at(start + (j * beat) / 3, tile(6, 23 + j, y, 0, 2, dotMask));
        at(page.start, tile(6, 23 + j, y, 0, 0, dotMask));
      }
    }
  }
  const end = pages.at(-1).end + 0.82;
  at(end, packet(1, [0, 0]));
  palette(end + 0.014, art.end, 0);
  batch(end + 0.03, end + 2.75, solid(art.outro));
  for (let level = 1; level <= 15; level++) palette(end + 0.29 + level * 0.185, art.end, level / 15);
  const used = new Uint8Array(count);
  let lag = 0;
  high.sort((a, b) => a.tick - b.tick);
  function write(n, p) {
    if (n >= count) throw Error('Graphics exceed audio');
    data.set(p, n * 24);
    used[n] = 1;
  }
  for (const { tick, p } of high) {
    let n = tick;
    while (used[n]) n++;
    write(n, p);
    lag = Math.max(lag, n - tick);
  }
  low.sort((a, b) => a.deadline - b.deadline);
  for (const job of low) {
    let n = job.start;
    for (const p of job.packets) {
      while (used[n]) n++;
      if (n > job.deadline)
        throw Error(
          'CD+G tile deadline missed ' +
            JSON.stringify([job.start / 300, job.deadline / 300, n / 300, job.packets.length])
        );
      write(n++, p);
    }
  }
  return {
    data,
    markers,
    pages: pages.map(({ words, start, end, enter, leave, lane }) => ({
      words,
      start,
      end,
      enter,
      leave,
      lane,
    })),
    cues,
    rests,
    introEnd,
    maxDelayMs: (lag * 1000) / 300,
    outro: end,
  };
}
