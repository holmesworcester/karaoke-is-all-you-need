// Draw timed lyrics over an uncaptioned video. All timing follows the media element.
const choices = {
  color: [
    ['white', 'White'],
    ['yellow', 'Alert yellow'],
    ['red', 'Signal red'],
    ['rose', 'Rose'],
  ],
  font: [
    ['condensed', 'Condensed'],
    ['round', 'Rounded'],
    ['bill', '¥UK1MAT$U'],
  ],
  position: [
    ['lower', 'Lower'],
    ['center', 'Center wide'],
    ['upper', 'Upper'],
  ],
};
const palettes = {
  white: ['#999a99', '#fafaf8'],
  yellow: ['#b8a366', '#ffec28'],
  red: ['#aa7c79', '#ff7467'],
  rose: ['#bd879b', '#ffccdd'],
};
const substitutions = { Y: '¥', O: 'Ø', U: 'U', S: '$', E: '€', I: '1' };
export function billLetters(text) {
  return text.toLocaleUpperCase('en').replace(/[YOSIE]/g, (c) => substitutions[c]);
}

export function mountLyrics({
  video,
  stage,
  controls,
  rows,
  initial = {},
  storageKey = 'karaoke-look-v1',
}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'lyric-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.append(canvas);
  const liveText = document.createElement('span');
  liveText.className = 'lyric-reading';
  stage.append(liveText);
  const ctx = canvas.getContext('2d');
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
  } catch {}
  const state = {};
  for (const [key, options] of Object.entries(choices)) {
    const value = initial[key] ?? saved[key];
    state[key] = options.some(([v]) => v === value) ? value : options[0][0];
  }
  state.script = (initial.script ?? saved.script) === 'arabic' ? 'arabic' : 'roman';
  const hasArabic = rows.some((row) => row.arabic);
  const fields = [];
  function store() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
    draw();
  }
  for (const [key, options] of Object.entries(choices)) {
    const field = document.createElement('fieldset');
    const title = document.createElement('legend');
    title.textContent = { color: 'Color', font: 'Lettering', position: 'Position' }[key];
    field.append(title);
    for (const [value, name] of options) {
      const label = document.createElement('label'),
        input = document.createElement('input');
      input.type = 'radio';
      input.name = 'lyric-' + key;
      input.value = value;
      input.checked = state[key] === value;
      input.addEventListener('change', () => {
        if (input.checked) {
          state[key] = value;
          store();
        }
      });
      const span = document.createElement('span');
      span.textContent = name;
      label.append(input, span);
      field.append(label);
    }
    controls.append(field);
    fields.push(field);
  }
  if (hasArabic) {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'lyric-script';
    label.setAttribute('role', 'switch');
    label.setAttribute('aria-label', 'Arabic script for XENA');
    function sync() {
      label.setAttribute('aria-checked', String(state.script === 'arabic'));
      label.textContent = state.script === 'arabic' ? 'XENA · العربية' : 'XENA · Roman';
    }
    label.addEventListener('click', () => {
      state.script = state.script === 'arabic' ? 'roman' : 'arabic';
      sync();
      store();
    });
    sync();
    controls.append(label);
    fields.push(label);
  }
  let currentWords = '',
    keyFrame;
  const ordered = [...rows].sort((a, b) => a.at - b.at);
  const longest = Math.max(0, ...ordered.map((r) => r.until - r.at));
  function upperBound(t) {
    let l = 0,
      r = ordered.length;
    while (l < r) {
      const m = (l + r) >> 1;
      if (ordered[m].at <= t) l = m + 1;
      else r = m;
    }
    return l;
  }
  function draw() {
    const bounds = video.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // object-fit:contain can letterbox the video in fullscreen.
    const ratio = (video.videoWidth || 1280) / (video.videoHeight || 720);
    const width = Math.min(bounds.width, bounds.height * ratio),
      height = width / ratio;
    const pw = Math.max(1, Math.round(width * dpr)),
      ph = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(pw / 1280, 0, 0, ph / 720, 0, 0);
    ctx.clearRect(0, 0, 1280, 720);
    const t = video.currentTime * 1000,
      active = ordered.slice(upperBound(t - longest - 1), upperBound(t)).filter((r) => r.until > t);
    const lines = active.filter((r) => r.words?.length);
    const accessible = lines
      .map((r) =>
        (state.script === 'arabic' && r.arabic ? r.arabic : r.words.map((w) => w[2])).join(' '),
      )
      .join('\n');
    if (currentWords !== accessible) {
      currentWords = accessible;
      liveText.textContent = accessible;
    }
    const [wait, lit] = palettes[state.color];
    ctx.lineJoin = 'round';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const r of active.filter((r) => r.title)) {
      ctx.direction = 'ltr';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#111';
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = Math.min(1, (t - r.at) / 280, (r.until - t) / 500);
      r.title.forEach((s, i) => {
        ctx.font = '700 ' + (i ? 28 : 48) + 'px KaraokeCondensed, sans-serif';
        ctx.strokeText(s, 44, 68 + i * 36);
        ctx.fillText(s, 44, 68 + i * 36);
      });
      ctx.globalAlpha = 1;
    }
    for (const row of lines) {
      const rtl = !!row.arabic && state.script === 'arabic';
      const texts = rtl
        ? row.arabic
        : row.words.map((w) => (state.font === 'bill' ? billLetters(w[2]) : w[2]));
      const family = rtl
        ? 'KaraokeArabic, sans-serif'
        : state.font === 'round'
          ? 'KaraokeRound, sans-serif'
          : state.font === 'bill'
            ? 'KaraokeBill, monospace'
            : 'KaraokeCondensed, sans-serif';
      const center = state.position === 'center';
      const font = (size) => '700 ' + size + 'px ' + family;
      const startSize = rtl ? 64 : 68;
      ctx.font = font(startSize);
      const lineWidth = () =>
        texts.reduce((sum, w) => sum + ctx.measureText(w).width, 0) +
        Math.max(0, texts.length - 1) * ctx.measureText(' ').width;
      const natural = lineWidth(),
        size = Math.min(
          center ? 112 : startSize,
          ((center ? 1220 : 1180) * startSize) / Math.max(1, natural),
        );
      ctx.font = font(size);
      ctx.direction = rtl ? 'rtl' : 'ltr';
      const widthLine = lineWidth();
      let x = rtl ? 640 + widthLine / 2 : 640 - widthLine / 2;
      // Center a single active row exactly; separate simultaneous voices or a preview above/below it.
      const lane = row.lane ?? 585;
      const lanes = [...new Set(lines.map((r) => r.lane ?? 585))].sort((a, b) => a - b);
      let y = lane - 14;
      if (center) {
        const slot = lanes.indexOf(lane) - (lanes.length - 1) / 2;
        const measured = ctx.measureText(texts.join(' '));
        y =
          360 +
          slot * (lanes.length > 2 ? 85 : 112) +
          (measured.actualBoundingBoxAscent - measured.actualBoundingBoxDescent) / 2;
      }
      if (state.position === 'upper') y = 105 + lanes.indexOf(lane) * 90;
      y = Math.max(size + 8, Math.min(696, y));
      ctx.lineWidth = Math.max(6, size * 0.115);
      ctx.strokeStyle = '#100e10';
      const gap = ctx.measureText(' ').width;
      for (let i = 0; i < texts.length; i++) {
        const [a, b] = row.words[i],
          w = texts[i],
          width = ctx.measureText(w).width,
          left = rtl ? x - width : x;
        const progress = Math.max(0, Math.min(1, (t - a) / Math.max(1, b - a)));
        const m = ctx.measureText(w);
        const inkLeft = left - Math.max(0, m.actualBoundingBoxLeft),
          inkRight = left + Math.max(width, m.actualBoundingBoxRight);
        ctx.strokeText(w, left, y);
        ctx.fillStyle = wait;
        ctx.fillText(w, left, y);
        if (progress > 0) {
          ctx.save();
          if (progress < 1) {
            const edge = inkRight - inkLeft;
            ctx.beginPath();
            ctx.rect(rtl ? inkRight - edge * progress : inkLeft, 0, edge * progress, 720);
            ctx.clip();
          }
          ctx.fillStyle = lit;
          ctx.fillText(w, left, y);
          ctx.restore();
        }
        x += (rtl ? -1 : 1) * (width + gap);
      }
    }
  }
  const observer = new ResizeObserver(draw);
  observer.observe(stage);
  const events = ['seeked', 'seeking', 'timeupdate', 'loadedmetadata', 'pause', 'ratechange', 'playing'];
  for (const e of events) video.addEventListener(e, draw);
  let closed = false;
  function frame() {
    if (closed) return;
    if (!video.paused && !video.ended) draw();
    keyFrame = requestAnimationFrame(frame);
  }
  document.fonts?.ready.then(() => {
    if (!closed) draw();
  });
  frame();
  return {
    state,
    draw,
    destroy() {
      closed = true;
      cancelAnimationFrame(keyFrame);
      observer.disconnect();
      for (const e of events) video.removeEventListener(e, draw);
      canvas.remove();
      liveText.remove();
      fields.forEach((f) => f.remove());
    },
  };
}
