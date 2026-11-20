import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../video/browser.mjs';
const dir = path.resolve('build/overlay-test');
await mkdir(dir, { recursive: true });
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'color=black:s=640x360:r=12:d=16',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  path.join(dir, 'picture.mp4'),
]);
const script = await readFile('src/lyric-overlay.js', 'utf8');
const style = await readFile('src/lyric-overlay.css', 'utf8');
const rows = [
  {
    at: 100,
    until: 5100,
    lane: 585,
    words: [
      [500, 2400, 'Yes'],
      [2600, 4750, 'so'],
    ],
    arabic: ['سلام', 'نور'],
  },
];
await writeFile(
  path.join(dir, 'index.html'),
  `<style>${style}body{margin:0}.lyric-stage{width:640px}</style><div class="lyric-stage"><video src="picture.mp4" preload="auto"></video></div><div class="lyric-controls"></div><script type=module>${script}
window.ui=mountLyrics({video:document.querySelector('video'),stage:document.querySelector('.lyric-stage'),controls:document.querySelector('.lyric-controls'),rows:${JSON.stringify(rows)}});
window.replaceScore=(rows)=>{
  window.ui.destroy();
  window.ui=mountLyrics({video:document.querySelector('video'),stage:document.querySelector('.lyric-stage'),controls:document.querySelector('.lyric-controls'),rows,initial:{position:'center',script:'roman'}});
};
window.billLetters=billLetters;</script>`,
);
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
  await page.waitForFunction(() => window.ui && document.querySelector('video').readyState >= 2);
  assert.equal(await page.evaluate(() => billLetters('Yousuke Yukimatsu')), '¥ØU$UK€ ¥UK1MAT$U');
  const seek = async (t) => {
    await page.locator('video').evaluate((v, t) => (v.currentTime = t), t);
    await page.waitForFunction((t) => {
      const v = document.querySelector('video');
      return !v.seeking && Math.abs(v.currentTime - t) < 0.01;
    }, t);
  };
  await seek(0.88);
  await page.getByText('Alert yellow', { exact: true }).click();
  await page.getByRole('switch', { name: 'Arabic script for XENA' }).click();
  await page.getByText('Center wide', { exact: true }).click();
  assert.equal(await page.locator('.lyric-reading').textContent(), 'سلام نور');
  const metric = () =>
    page.locator('canvas').evaluate((c) => {
      const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      let lit = 0,
        mx = 0,
        my = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] > 244 && data[i + 1] > 213 && data[i + 2] < 95 && data[i + 3] > 190) {
          const p = i / 4;
          lit++;
          mx += p % c.width;
          my += Math.floor(p / c.width);
        }
      return { lit, x: mx / lit, y: my / lit, w: c.width, h: c.height };
    });
  const a = await metric();
  await seek(2.18);
  const b = await metric();
  assert(a.lit > 0 && b.lit > a.lit * 1.7 && b.x < a.x, 'Arabic sweep expands to the left');
  assert(Math.abs(b.y - b.h / 2) < b.h * 0.12, 'Center layout is visually centered');
  await page.getByText('Lower', { exact: true }).click();
  const low = await metric();
  assert(low.y > b.y + 0.18 * b.h);
  await page.getByText('Upper', { exact: true }).click();
  const high = await metric();
  assert(high.y < b.y - 0.18 * b.h);
  await seek(2.5);
  const hold = await metric();
  await seek(2.55);
  assert.deepEqual(await metric(), hold);
  await page.getByText('Signal red', { exact: true }).click();
  assert.equal((await metric()).lit, 0);
  await seek(5.8);
  assert.equal(await page.locator('.lyric-reading').textContent(), '');
  const phrase = (text, at, start, end, until) => ({
    words: [[start, end, text]], lane: 558, at, until,
  });
  // These source rows share a lane just like a sequence of chopped responses. Later the
  // lead sustains through two replies and a brief third voice.
  const score = [
    phrase('Opening', 700, 1200, 1700, 1750),
    phrase('Reply', 1950, 2200, 2850, 2870),
    phrase('again', 2800, 3100, 4250, 4280),
    phrase('YES', 4100, 4400, 4950, 5050),
    phrase('Sustain', 10000, 10300, 12400, 12480),
    phrase('Echo', 10400, 10600, 11500, 11580),
    phrase('Third', 10650, 10850, 11200, 11280),
    phrase('Reprise', 11500, 11700, 12700, 12780),
  ];
  await page.evaluate((rows) => window.replaceScore(rows), score);
  // Capture what canvas actually draws, including the baseline passed to the font renderer.
  async function drawn(time) {
    await seek(time);
    return page.evaluate(() => {
      const c = document.querySelector('canvas').getContext('2d');
      const stroke = c.strokeText;
      const lines = {};
      c.strokeText = function (text, x, y) {
        lines[text] = y;
        return stroke.call(this, text, x, y);
      };
      try { window.ui.draw(); } finally { c.strokeText = stroke; }
      return lines;
    });
  }
  const { Opening: top } = await drawn(0.8);
  const { Reply: bottom } = await drawn(1.4);
  assert(top < bottom && bottom - top >= 110);
  assert.deepEqual(await drawn(1.2), { Opening: top, Reply: bottom });
  assert.deepEqual(await drawn(2.199), { Opening: top, Reply: bottom });
  assert.deepEqual(await drawn(2.2), { again: top, Reply: bottom });
  assert.deepEqual(await drawn(3.1), { again: top, YES: bottom });
  assert.deepEqual(await drawn(4.41), { YES: bottom });
  assert.deepEqual(await drawn(8), {});
  assert.deepEqual(await drawn(10.1), { Sustain: top });
  assert.deepEqual(await drawn(10.7), { Sustain: top, Echo: bottom });
  const trio = await drawn(10.9);
  assert.equal(trio.Sustain, top);
  assert.equal(trio.Echo, bottom);
  assert(trio.Third < top);
  assert.deepEqual(await drawn(11.35), { Sustain: top, Echo: bottom });
  assert.deepEqual(await drawn(11.52), { Sustain: top, Reprise: bottom });
  assert.deepEqual(await drawn(12.6), { Reprise: bottom });
  assert.deepEqual(await drawn(2.2), { again: top, Reply: bottom });
  console.log(
    'Checked RTL glyph sweep, all three placements, held endings, palette selection, bill lettering, and fixed two-line handoffs through rests, overlaps, and backward seeks.',
  );
} finally {
  await browser.close();
}
