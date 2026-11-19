import CDGraphics from 'cdgraphics';
import { zipSync } from 'fflate';
import { attachAudioComparison } from './audio-comparison.js';
import { compile } from './compile.js';

const $ = (s) => document.querySelector(s);
const audio = $('audio'),
  player = $('#player');
const ctx = $('#screen').getContext('2d', { alpha: false });
const art = JSON.parse($('#art').textContent),
  timing = JSON.parse($('#timing').textContent);
const words = JSON.parse($('#edition').textContent);
const digest = $('#wordhash').textContent.trim();
const song = JSON.parse($('#song').textContent);
if (art.coverPalette) {
  for (const [index, name] of ['backdrop', 'paper', 'lit', '', 'muted'].entries())
    if (name) document.documentElement.style.setProperty('--' + name, '#' + art.live[index]);
}
if (art.fullBleed) {
  ctx.canvas.width = 288;
  ctx.canvas.height = 192;
  ctx.canvas.classList.add('bleed');
}
if (song.artworkIntro) $('#intro').hidden = true;
const base = [song.artist, song.title].filter(Boolean).join(' - ') + ' (Karaoke)';
const bytes = Uint8Array.from(atob($('#sound').textContent.trim()), (c) => c.charCodeAt(0));
const comparison = $('#comparison').textContent.trim();
if (comparison && (window.AudioContext || window.webkitAudioContext)) {
  const encoded = Uint8Array.from(atob(comparison), c => c.charCodeAt(0));
  audio.src = URL.createObjectURL(new Blob([encoded], { type: 'audio/mp4' }));
  attachAudioComparison(audio, $('#audio-mode'));
} else {
  audio.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
}
const lanes = [...document.querySelectorAll('.lane')].map((el) => ({
  text: el.querySelector('.lyric'),
  dots: el.querySelector('.cue'),
  page: null,
  spans: [],
}));
for (const lane of lanes) {
  lane.dots.append(...Array.from({ length: 4 }, () => document.createElement('i')));
}
let score, cdg, animation, hideTimer;

function drawLane(lane, page, cue, t) {
  if (page !== lane.page) {
    lane.page = page;
    lane.text.replaceChildren();
    lane.spans = [];
    if (page) {
      for (const word of page.words) {
        const el = document.createElement('span');
        el.className = 'word';
        el.textContent = word.text;
        el.dataset.text = word.text;
        el.dataset.word = word.id.join('-');
        if (lane.spans.length) lane.text.append(' ');
        lane.text.append(el);
        lane.spans.push(el);
      }
    }
  }
  if (page)
    page.words.forEach((word, i) => {
      const f = Math.max(0, Math.min(1, (t - word.start) / (word.end - word.start)));
      const right = ((1 - f) * 100).toFixed(2) + '%';
      const el = lane.spans[i];
      if (el.style.getPropertyValue('--right') !== right) {
        el.style.setProperty('--right', right);
        el.dataset.fill = right === '100.00%' ? 'waiting' : right === '0.00%' ? 'sung' : 'sweep';
      }
    });
  lane.dots.hidden = !cue;
  if (cue) {
    const step = Math.floor(((t - cue.start) / (cue.end - cue.start)) * cue.count);
    const count = cue.kind === 'pickup' ? step + 1 : cue.count - step;
    [...lane.dots.children].forEach((dot, j) => {
      dot.hidden = j >= count;
    });
  }
}
function show() {
  cancelAnimationFrame(animation);
  if (!score) return;
  const t = audio.currentTime;
  const intro = t < score.introEnd,
    end = t >= score.outro;
  const rest = score.rests.some(([a, b]) => a <= t && t < b);
  const cover = end || (intro && score.introArtStart !== null && t >= score.introArtStart);
  $('#intro').hidden = !intro || cover;
  $('#rest').hidden = !rest;
  $('#ending').hidden = !cover;
  $('#lanes').hidden = intro || rest || end;
  if (cover) {
    const frame = cdg.render(t);
    if (frame.isChanged) {
      ctx.putImageData(frame.imageData, art.fullBleed ? -6 : -54, art.fullBleed ? -12 : -21);
      ctx.canvas.dataset.paintTime = String(t);
    }
  } else if (!intro && !rest) {
    lanes.forEach((lane, i) => {
      const page = score.pages.find((p) => p.lane === i && p.enter <= t && t < p.leave) || null;
      const cue = score.cues.find((c) => c.lane === i && c.start <= t && t < c.end);
      drawLane(lane, page, cue, t);
    });
  }
  if (!audio.paused && !audio.ended) animation = requestAnimationFrame(show);
}
function revealControls() {
  player.classList.remove('quiet');
  clearTimeout(hideTimer);
  if (!audio.paused && !audio.ended) hideTimer = setTimeout(() => player.classList.add('quiet'), 1800);
}
for (const event of [
  'play',
  'playing',
  'pause',
  'seeking',
  'seeked',
  'ratechange',
  'ended',
  'loadedmetadata',
  'timeupdate',
])
  audio.addEventListener(event, show);
for (const event of ['play', 'pause', 'seeking']) audio.addEventListener(event, revealControls);
audio.addEventListener('ended', () => {
  clearTimeout(hideTimer);
  player.classList.add('quiet');
});
for (const event of ['pointerdown', 'pointermove'])
  player.addEventListener(event, () => {
    player.classList.add('pointer-mode');
    revealControls();
  });
document.addEventListener('visibilitychange', show);
document.addEventListener('keydown', (event) => {
  player.classList.remove('pointer-mode');
  revealControls();
  if (event.key === 'Escape') player.classList.remove('expanded');
  if (
    event.code !== 'Space' ||
    !score ||
    event.repeat ||
    ['INPUT', 'BUTTON', 'A', 'AUDIO'].includes(event.target.tagName)
  )
    return;
  event.preventDefault();
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
$('#fullscreen').addEventListener('click', async () => {
  if (player.classList.contains('expanded')) {
    player.classList.remove('expanded');
    return;
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await player.requestFullscreen();
  } catch {
    player.classList.add('expanded');
  }
  revealControls();
});
$('#save').addEventListener('click', () => {
  if (!score) return;
  const file = zipSync({ [base + '.cdg']: score.data, [base + '.mp3']: bytes }, { level: 0 });
  const url = URL.createObjectURL(new Blob([file], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = base + '.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});
async function prepare() {
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(words)));
    const hex = [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join('');
    if (
      hex !== digest ||
      words.length !== timing.length ||
      words.some((r, i) => r.length !== timing[i].length)
    )
      throw Error('Edition mismatch');
    score = compile(words, timing, art, song.duration, song);
    cdg = new CDGraphics(score.data.buffer);
    show();
    audio.controls = true;
    $('#save').disabled = false;
  } catch {
    $('#intro').hidden = true;
    $('#problem').textContent = 'This track could not open. Reload the player to get the complete file.';
    $('#problem').hidden = false;
  }
}
prepare();
