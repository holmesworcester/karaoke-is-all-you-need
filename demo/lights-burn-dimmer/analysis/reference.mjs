import { launch, stage } from '../../../video/browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const player = process.argv[2] || 'build/demo.html';
const out = path.resolve(process.argv[3] || 'build/video-qc') + path.sep;
await mkdir(out, { recursive: true });
const b = await launch();
try {
  const p = await stage(b, player, { fixedClock: false });
  const seconds = [
    0, 1, 2.183, 2.25, 3.7, 5.6, 5.85, 6.43, 17.64, 17.76, 20.75, 21.05, 21.2, 30.14, 39.18, 43.983, 44,
    48.23, 57.24, 64.34, 74.5, 87.983, 88, 104.7, 109.45, 123.7, 131.983, 132, 136.22, 139.76, 154.42, 165.78,
    165.93, 175.983, 176, 184.6, 208.3, 219.983, 220, 230.43, 235.75, 240.68, 255.93, 256.36, 257.5, 258.45,
    259.82, 261, 263.85,
  ];
  const samples = [];
  const cdp = await p.context().newCDPSession(p);
  for (const sec of seconds) {
    const frame = Math.round(sec * 60);
    const time = frame / 60;
    await p.evaluate(async (t) => {
      const a = document.querySelector('audio');
      if (Math.abs(a.currentTime - t) > 0.000001) {
        const sought = new Promise((r) => a.addEventListener('seeked', r, { once: true }));
        a.currentTime = t;
        await sought;
      }
      await new Promise(requestAnimationFrame);
    }, time);
    const active = await p.evaluate(() =>
      [...document.querySelectorAll('#lanes:not([hidden]) .word[data-fill="sweep"]')].map((e) => {
        const r = e.getBoundingClientRect();
        return [Math.floor(r.left), Math.floor(r.top), Math.ceil(r.right), Math.ceil(r.bottom)];
      })
    );
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    const index = String(samples.length + 1).padStart(3, '0');
    await writeFile(out + 'ref' + index + '.png', Buffer.from(data, 'base64'));
    samples.push({ frame, time, active });
  }
  await writeFile(out + 'samples.json', JSON.stringify(samples));
  console.log(samples.length, 'independent seek references');
} finally {
  await b.close();
}
