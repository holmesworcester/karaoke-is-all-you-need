import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { launch, stage } from './browser.mjs';

const {
  positionals: [player, output],
  values,
} = parseArgs({
  allowPositionals: true,
  options: { jobs: { type: 'string', default: '2' }, audio: { type: 'string' } },
});
if (!player || !output)
  throw Error('Usage: node video/export.mjs PLAYER.html OUTPUT.mp4 [--jobs 2] [--audio MASTER.wav]');
const concurrency = Number(values.jobs);
if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw Error('--jobs must be a positive integer');
const outDir = path.dirname(path.resolve(output));
await fs.mkdir(outDir, { recursive: true });
const tmp = await fs.mkdtemp(path.join(outDir, '.karaoke-export-'));
const fps = 60,
  perPart = 44 * fps;
async function render(browser, index, start, end) {
  const page = await stage(browser, player);
  const cdp = await page.context().newCDPSession(page);
  const encoder = spawn(
    'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-threads',
      '1',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-c:v',
      'png',
      '-i',
      'pipe:0',
      '-filter_threads',
      '1',
      '-vf',
      'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
      '-c:v',
      'libx264',
      '-threads',
      '3',
      '-preset',
      'veryfast',
      '-crf',
      '16',
      '-profile:v',
      'high',
      '-level:v',
      '4.2',
      '-g',
      '120',
      '-colorspace',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_primaries',
      'bt709',
      '-video_track_timescale',
      '60000',
      '-an',
      'part-' + index + '.mp4',
    ],
    { cwd: tmp, stdio: ['pipe', 'ignore', 'inherit'] }
  );
  const exited = new Promise((resolve) => {
    encoder.once('error', resolve);
    encoder.once('close', resolve);
  });
  encoder.stdin.on('error', () => {}); // Write callbacks below propagate pipe failures.
  try {
    let image;
    for (let frame = start; frame < end; frame++) {
      if ((await page.evaluate((t) => window.needsImage(t), frame / fps)) || !image) {
        const shot = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          optimizeForSpeed: true,
          fromSurface: true,
        });
        image = Buffer.from(shot.data, 'base64');
      }
      await new Promise((resolve, reject) =>
        encoder.stdin.write(image, (error) => (error ? reject(error) : resolve()))
      );
    }
    encoder.stdin.end();
    const code = await exited;
    if (code !== 0) throw Error('Frame encoder failed: ' + code);
    console.log('Encoded frames ' + start + ' through ' + (end - 1));
  } finally {
    if (encoder.exitCode === null) encoder.kill();
    await page.context().close();
  }
}
let browser;
try {
  browser = await launch();
  const page = await stage(browser, player);
  const duration = await page.locator('audio').evaluate((a) => a.duration);
  let audio = values.audio && path.resolve(values.audio);
  if (!audio) {
    audio = path.join(tmp, 'backing.mp3');
    await fs.writeFile(audio, Buffer.from(await page.locator('#sound').textContent(), 'base64'));
  } else {
    const length = Number(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nw=1:nk=1',
        audio,
      ])
    );
    if (Math.abs(length - duration) > 0.05)
      throw Error('Audio master duration differs from player; include the artwork hold');
  }
  await page.context().close();
  const total = Math.ceil(duration * fps),
    parts = Math.ceil(total / perPart);
  let next = 0,
    failed = false;
  async function worker() {
    while (!failed && next < parts) {
      const index = next++;
      try {
        await render(browser, index, index * perPart, Math.min(total, (index + 1) * perPart));
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(parts, concurrency) }, worker));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  await fs.writeFile(
    path.join(tmp, 'parts.txt'),
    Array.from({ length: parts }, (_, i) => "file 'part-" + i + ".mp4'").join('\n') + '\n'
  );
  execFileSync(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'parts.txt',
      '-i',
      audio,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '256k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-video_track_timescale',
      '60000',
      '-movflags',
      '+faststart',
      'finished.mp4',
    ],
    { cwd: tmp, stdio: 'inherit' }
  );
  await fs.rename(path.join(tmp, 'finished.mp4'), output);
  console.log(output);
} finally {
  try {
    if (browser) await browser.close();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
