import assert from 'node:assert/strict';
import { launch, stage } from '../video/browser.mjs';

const browser = await launch();
try {
  const page = await stage(browser, process.argv[2]);
  const means = [];
  for (const time of [0, 1.5, 3, 5, 6.5]) {
    const value = await page.evaluate((t) => {
      window.needsImage(t);
      const canvas = document.querySelector('#screen');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return { sum, titleHidden: document.querySelector('#intro').hidden, cover: !canvas.parentElement.hidden };
    }, time);
    assert(value.titleHidden && value.cover);
    means.push(value.sum);
  }
  assert.equal(means[0], 0);
  for (let i = 1; i < means.length; i++) assert(means[i] > means[i - 1], means);
  assert(means[1] < means.at(-1) * 0.4);
  if (process.argv.includes('--wide')) {
    for (const [width, height] of [[1920, 1080], [390, 844]]) {
      await page.setViewportSize({ width, height });
      const dimensions = await page.evaluate(() => {
        window.needsImage(6.6);
        const canvas = document.querySelector('#screen');
        const r = canvas.getBoundingClientRect();
        const ctx = canvas.getContext('2d');
        const edges = [[1, 96], [286, 96], [144, 1], [144, 190]].map(([x, y]) =>
          Math.max(...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)));
        return [r.left, r.top, r.width, r.height, edges];
      });
      assert.deepEqual(dimensions.slice(0, 4), [0, 0, width, height]);
      assert(dimensions[4].every(v => v > 64));
    }
  }
  assert(await page.evaluate(() => { window.needsImage(11.5); return !!document.querySelector('#lanes:not([hidden]) .word[data-fill="sweep"]'); }));
} finally {
  await browser.close();
}
