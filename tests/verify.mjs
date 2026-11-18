import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import CDGraphics from 'cdgraphics';
import { unzipSync } from 'fflate';
import { compile } from '../src/compile.js';
import { verifyPackets } from './check-packets.mjs';
import { checkGlyphs } from './check-glyphs.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url)),
  live = process.argv.includes('--live');
const html = await fs.readFile(
  process.env.KARAOKE_TEST_PLAYER || path.join(dir, '../build', live ? 'demo.html' : 'fixture.html'),
  'utf8'
);
const readJSON = async (n) =>
  JSON.parse(await fs.readFile(path.join(dir, '../demo/lights-burn-dimmer', n), 'utf8'));
const block = (id) => html.match(new RegExp('<script id="' + id + '"[^>]*>(.*?)</script>', 's'))[1];
const times = JSON.parse(block('timing')),
  art = JSON.parse(block('art')),
  hash = block('wordhash');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const fixture = times.map((row, i) => row.map((_, j) => ['go', 'on', 'over', 'now', 'again'][(i + j) % 5]));
fixture[5][4] = 'sipping';
fixture[1][5] = 'you';
for (const i of [7, 11, 19, 23, 53]) fixture[i].splice(0, 3, 'Any', 'which', 'way');
const edition = JSON.parse(block('edition'));
const testWords = live ? edition : fixture;
const song = JSON.parse(block('song'));
const sourceScore = compile(testWords, times, art, song.duration, song);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'karaoke-check-'));
const reportDir = path.join(dir, '../artifacts');
await fs.mkdir(reportDir, { recursive: true });
const report = { mode: live ? 'studio release' : 'deterministic fixture', checks: [] };
const check = (label, msg = true) => {
  assert.ok(msg, label);
  report.checks.push(label);
};
const url = pathToFileURL(path.join(tmp, 'player.html')).href;
await fs.writeFile(
  path.join(tmp, 'player.html'),
  live
    ? html
    : html.replace(block('edition'), JSON.stringify(fixture)).replace(hash, sha(JSON.stringify(fixture)))
);
const b = await chromium.launch({
  executablePath: process.env.KARAOKE_CHROME || undefined,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await b.newContext({ viewport: { width: 960, height: 760 } }),
  p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
globalThis.ImageData = class ImageData {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
};
const external = [];
ctx.on('request', (r) => {
  if (/^https?:/.test(r.url())) external.push(r.url());
});
const setupReady = () =>
  p.waitForFunction(
    () =>
      document.querySelector('audio').readyState >= 2 &&
      document.querySelector('audio').controls &&
      !document.querySelector('#save').disabled,
    null,
    { timeout: 24000 }
  );
const seek = (t) =>
  p.evaluate(async (t) => {
    const a = document.querySelector('audio');
    a.pause();
    if (Math.abs(a.currentTime - t) > 0.000001) {
      const done = new Promise((resolve) => a.addEventListener('seeked', resolve, { once: true }));
      a.currentTime = t;
      await done;
    }
    await new Promise(requestAnimationFrame);
  }, t);
const snapshot = () =>
  p.evaluate(() => {
    const phase = !document.querySelector('#intro').hidden
      ? 'intro'
      : !document.querySelector('#rest').hidden
        ? 'rest'
        : !document.querySelector('#ending').hidden
          ? 'ending'
          : 'lyrics';
    const lanes = [...document.querySelectorAll('.lane')].map((l) => ({
      words: [...l.querySelectorAll('.word')].map((e) => [
        e.dataset.word,
        Number.parseFloat(e.style.getPropertyValue('--right')),
      ]),
      dots: l.querySelector('.cue').hidden ? 0 : l.querySelectorAll('.cue i:not([hidden])').length,
    }));
    return {
      time: document.querySelector('audio').currentTime,
      phase,
      lanes: phase === 'lyrics' ? lanes : [],
    };
  });
try {
  await ctx.setOffline(true);
  await p.goto(url);
  await setupReady();
  await p.evaluate(() => document.fonts.ready);
  check('Cold start works offline without local storage or third-party requests', external.length === 0);
  const download = p.waitForEvent('download');
  await p.locator('#save').click();
  const zipPath = path.join(tmp, 'export.zip');
  await (await download).saveAs(zipPath);
  const files = unzipSync(new Uint8Array(await fs.readFile(zipPath)));
  const entries = Object.entries(files);
  assert.equal(entries.length, 2);
  const [cg, g] = entries.find(([k]) => k.endsWith('.cdg')),
    [mp, audio] = entries.find(([k]) => k.endsWith('.mp3'));
  check(
    'Native MP3+G export pairs same-named files with intact audio',
    cg.slice(0, -4) === mp.slice(0, -4) && sha(audio) === sha(Buffer.from(block('sound'), 'base64'))
  );
  const initialPalette = (graphics) => {
    for (let pos = 0; pos < graphics.length; pos += 24) {
      if (graphics[pos] === 9 && graphics[pos + 1] === 30) {
        return [0, 1, 2].map((k) => (graphics[pos + 4 + 2 * k] << 6) | graphics[pos + 5 + 2 * k]);
      }
    }
    throw Error('Missing CD+G color table');
  };
  await checkGlyphs(p, times, seek, '#ffffff', '#999999');
  check('The white sweep covers solid glyphs and descenders during partial and completed words');
  assert.deepEqual(initialPalette(g), [0, 0x999, 0xfff]);
  check('MP3+G export uses the white sweep');
  await p.evaluate(() => localStorage.setItem('lights-burn-dimmer/colors', 'gold'));
  await p.reload();
  await setupReady();
  await seek(17.75);
  assert.equal(await p.locator('select').count(), 0);
  assert.equal(
    await p.locator('[data-word="5-4"]').evaluate((el) => getComputedStyle(el).color),
    'rgb(255, 255, 255)'
  );
  check('Returning listeners get the white sweep and the streamlined controls');
  const ms = live
    ? (await readJSON('real-probes.json')).map(([id, x, y]) => ({
        id,
        t: times[id[0]][id[1]][0] / 1000,
        p: [x, y],
      }))
    : compile(fixture, times, art, song.duration, song).markers;
  assert.equal(ms.length, 787);
  assert.deepEqual(verifyPackets(g, ms), []);
  check(
    'All 787 first-sweep pixels switch from the waiting to the sung palette index between 18 ms before and 33 ms after onset'
  );
  for (const [label, shift] of [
    ['120 ms early', () => -0.12],
    ['120 ms late', () => 0.12],
    ['0.2% drift', (t) => t * 0.002],
  ]) {
    const failures = verifyPackets(g, ms, shift);
    check('Detects injected ' + label + ' error', failures.length > 700);
  }
  const swept = await p.evaluate(async (timing) => {
    const a = document.querySelector('audio');
    let count = 0;
    for (const [i, row] of timing.entries())
      for (const [j, [start, end]] of row.entries()) {
        const midpoint = (start + end) / 2000;
        const done = new Promise((resolve) => a.addEventListener('seeked', resolve, { once: true }));
        a.currentTime = midpoint;
        await done;
        const word = document.querySelector('[data-word="' + i + '-' + j + '"]');
        if (!word || word.getBoundingClientRect().width <= 0) throw Error('Invisible word ' + i + '-' + j);
        const right = Number.parseFloat(word.style.getPropertyValue('--right'));
        if (Math.abs(right - 50) > 0.25 || !getComputedStyle(word, '::after').clipPath.includes('50%'))
          throw Error('Sweep missed ' + i + '-' + j + ' at ' + right);
        count++;
      }
    return count;
  }, times);
  check(
    'All 787 scalable browser words reach a half-width color sweep at their audio midpoints',
    swept === 787
  );
  const audit = await readJSON('acoustic-audit.json');
  const delta = audit.repeatedVocalLandmarks
    .map(([i, j, t]) => Math.abs(times[i][j][0] - t))
    .sort((x, y) => x - y);
  check(
    '58 held-out repeated vocal matches stay within 35 ms of the reference occurrence',
    delta.length === 58 && delta.at(-1) < 35
  );
  const reference = new CDGraphics(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength));
  async function assertFrame() {
    const s = await snapshot(),
      t = s.time;
    const phase =
      t < 2.2
        ? 'intro'
        : t >= 257.253
          ? 'ending'
          : sourceScore.rests.some(([a, b]) => a <= t && t < b)
            ? 'rest'
            : 'lyrics';
    assert.equal(s.phase, phase, 'Screen at ' + t);
    if (phase === 'lyrics')
      for (let lane = 0; lane < 2; lane++) {
        const page = sourceScore.pages.find((v) => v.lane === lane && v.enter <= t && t < v.leave);
        const expected = (page?.words || []).map((w) => [
          w.id.join('-'),
          Number((Math.max(0, Math.min(1, (w.end - t) / (w.end - w.start))) * 100).toFixed(2)),
        ]);
        assert.deepEqual(s.lanes[lane].words, expected, 'Word sweeps at ' + t);
        const c = sourceScore.cues.find((v) => v.lane === lane && v.start <= t && t < v.end);
        const k = c ? Math.floor(((t - c.start) / (c.end - c.start)) * c.count) : 0;
        assert.equal(
          s.lanes[lane].dots,
          c ? (c.kind === 'pickup' ? k + 1 : c.count - k) : 0,
          'Cue dots at ' + t
        );
      }
    return s;
  }
  const duration = await p.locator('audio').evaluate((a) => a.duration);
  check(
    'Decoded backing includes the original music and three-second ending hold',
    Math.abs(duration - 263.87932) < 0.03
  );
  for (const t of [
    0, 5.53, 5.69, 7.1, 123.7, 34, 139.4, 229.1, 240.4, 10.65, 255.81, 262.4, 232.6, 64.36, 256.1,
  ]) {
    await seek(t);
    await assertFrame();
  }
  check(
    'Forward and backward seeks reproduce exact frames across intro, ad-libs, instrumental, chopped hooks and cover'
  );
  for (const rate of [0.5, 1, 1.75]) {
    await seek(32.2);
    await p.locator('audio').evaluate(async (a, r) => {
      a.playbackRate = r;
      await a.play();
    }, rate);
    await p.waitForTimeout(300);
    const pos = await p.locator('audio').evaluate((a) => {
      a.pause();
      return a.currentTime;
    });
    assert.ok(pos > 32.2 + 0.18 * rate);
    await assertFrame();
    const paused = await snapshot();
    await p.waitForTimeout(160);
    assert.deepEqual(await snapshot(), paused);
  }
  check('Pause freezes the graphics and resume follows the media clock at 0.5×, 1× and 1.75×');
  await seek(40);
  await p.locator('audio').evaluate(async (a) => {
    a.playbackRate = 1;
    await a.play();
    await new Promise(requestAnimationFrame);
    const until = performance.now() + 480;
    while (performance.now() < until) {}
    await new Promise(requestAnimationFrame);
    a.pause();
  });
  await p.waitForTimeout(30);
  await assertFrame();
  check('A blocked animation thread catches up to audio without replaying late highlights');
  await seek(123.7);
  check(
    'Instrumental break shows only the break caption',
    (await p.locator('#rest').isVisible()) && !(await p.locator('#lanes').isVisible())
  );
  const pickups = [21.128, 30.188, 48.295, 57.348, 165.835],
    beat = 60 / 106;
  assert.deepEqual(
    sourceScore.cues.filter((c) => c.kind === 'pickup').map((c) => c.end),
    pickups
  );
  for (const end of pickups) {
    for (const [offset, n] of [
      [-beat - 0.01, 0],
      [-beat + 0.018, 1],
      [(-beat * 2) / 3 + 0.018, 2],
      [-beat / 3 + 0.018, 3],
      [0.012, 0],
    ]) {
      await seek(end + offset);
      const frame = await assertFrame();
      assert.equal(
        frame.lanes.reduce((s, l) => s + l.dots, 0),
        n
      );
    }
  }
  await seek(39.18);
  assert.equal(
    (await assertFrame()).lanes.reduce((s, l) => s + l.dots, 0),
    0
  );
  check('Three dots count in the five delayed entries and skip the uninterrupted edit');
  await seek(1);
  check(
    'Only the song title appears on the opening card',
    (await p.locator('#intro').isVisible()) &&
      (await p.locator('#intro').innerText()) === 'Lights Burn Dimmer'
  );
  await seek(10);
  check('The opening title clears for the singing', !(await p.locator('h1').isVisible()));
  for (const t of [10, 34, 96, 167, 240]) {
    const rgba = reference.render(t).imageData.data;
    for (let y = 0; y < 216; y++)
      for (let x = 6; x < 12; x++) {
        const off = (y * 300 + x) * 4;
        assert.ok(!(rgba[off] === 255 && rgba[off + 1] === 187), 'Unexpected side arrow');
      }
  }
  check('The native graphics leave the former singer-arrow column empty');
  const luminance = [];
  for (const t of [257.3, 258.4, 259.5, 260.75, 262.6]) {
    await seek(t);
    await assertFrame();
    luminance.push(
      await p.evaluate(() => {
        const d = document.querySelector('canvas').getContext('2d').getImageData(0, 0, 192, 174).data;
        let sum = 0;
        const colors = new Set();
        for (let i = 0; i < d.length; i += 4) {
          sum += d[i];
          colors.add(d[i] * 65536 + d[i + 1] * 256 + d[i + 2]);
        }
        return [sum, colors.size];
      })
    );
  }
  check(
    'Cover fades through at most 16 colors, brightens, then holds',
    luminance.every((x) => x[1] <= 16) &&
      luminance[0][0] < luminance[1][0] &&
      luminance[1][0] < luminance[2][0] &&
      luminance[2][0] < luminance[3][0] &&
      luminance[3][0] === luminance[4][0]
  );
  await seek(duration - 0.085);
  await p.locator('audio').evaluate(async (a) => {
    await a.play();
    await new Promise((res) => a.addEventListener('ended', res, { once: true }));
  });
  await assertFrame();
  await seek(0);
  await assertFrame();
  check('End, rewind and replay restore the opening frame');
  const screenSizes = [
    [390, 844],
    [844, 390],
    [1366, 768],
    [1920, 1080],
  ];
  for (const [width, height] of screenSizes) {
    await p.setViewportSize({ width, height });
    for (const t of [10.7, 21.05, 74.5, 184.6, 238.7]) {
      await seek(t);
      await assertFrame();
      const layout = await p.evaluate(() => {
        const display = document.querySelector('#display').getBoundingClientRect();
        const boxes = [...document.querySelectorAll('.word')].map((el) => el.getBoundingClientRect());
        return [
          display.width === innerWidth && display.height === innerHeight,
          boxes.every(
            (r) => r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1
          ),
          document.fonts.check('700 40px Stage'),
        ];
      });
      assert.deepEqual(layout, [true, true, true]);
    }
  }
  check('Smooth font and full-viewport lyrics fit portrait and landscape phones, laptop and TV screens');
  await seek(33);
  await p.locator('#fullscreen').click();
  await p.waitForFunction(
    () =>
      document.fullscreenElement === document.querySelector('main') ||
      document.querySelector('main').classList.contains('expanded')
  );
  await seek(34);
  await assertFrame();
  await p.locator('#fullscreen').click();
  check('Fullscreen keeps transport and singing available');
  await seek(262);
  assert.equal(await p.locator('#ending').innerText(), '');
  const endPixels = reference.render(262).imageData.data;
  for (let i = 0; i < endPixels.length; i += 4) assert.equal(endPixels[i], endPixels[i + 1]);
  check('Closing frame contains only monochrome album artwork in both playback formats');
  await ctx.setOffline(true);
  await p.reload();
  await setupReady();
  await seek(64.34);
  await assertFrame();
  check('Offline reload returns to the same edition');
  const invalid = testWords.map((row) => row.slice());
  invalid[0][0] = 'incorrect';
  const wrong = path.join(tmp, 'wrong.html');
  await fs.writeFile(wrong, html.replace(block('edition'), JSON.stringify(invalid)));
  await p.goto(pathToFileURL(wrong).href);
  await p.locator('#problem').waitFor();
  assert.ok(await p.locator('#save').isDisabled());
  check('A wrong edition with identical row and word counts is rejected');
  await p.goto(url);
  await setupReady();
  assert.equal(external.length, 0);
  check('Valid file recovers immediately without fetching lyrics');
  assert.deepEqual(errors, []);
  report.result = 'passed';
  console.log(report.checks.length + ' checks passed (' + report.mode + ')');
} catch (e) {
  report.result = 'failed';
  report.failure = e.message;
  await p.screenshot({ path: path.join(reportDir, 'failure.png') }).catch(() => {});
  throw e;
} finally {
  await fs.writeFile(
    path.join(reportDir, live ? 'studio.json' : 'deterministic.json'),
    JSON.stringify(report, null, 2)
  );
  await b.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
