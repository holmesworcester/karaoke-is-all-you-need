import assert from 'node:assert/strict';

// Use the browser's solid text as the reference. Capture beyond the word box as
// well, since ink below the baseline or outside the advance width can overflow.
export async function checkGlyphs(page, timing, seek, sungColor, waitingColor) {
  for (const [i, j] of [
    [5, 4],
    [1, 5],
  ]) {
    const [start, end] = timing[i][j];
    for (const fraction of [0, 0.78, 0.97, 1]) {
      await seek((start + (end - start) * fraction + (fraction === 1 ? 8 : 0)) / 1000);
      const word = page.locator('[data-word="' + i + '-' + j + '"]');
      const rect = await word.boundingBox();
      assert.ok(rect, 'The test word is visible');
      const x = Math.floor(rect.x) - 4,
        y = Math.floor(rect.y) - 6;
      const clip = {
        x,
        y,
        width: Math.ceil(rect.x + rect.width) + 4 - x,
        height: Math.ceil(rect.y + rect.height) + 6 - y,
      };
      const snap = async () => (await page.screenshot({ clip, scale: 'css' })).toString('base64');
      const target = '[data-word="' + i + '-' + j + '"]';
      const actual = await snap();
      const refs = [];
      for (const color of [sungColor, waitingColor]) {
        const style = await page.addStyleTag({
          content:
            target +
            '{color:' +
            color +
            '!important;background:none!important;-webkit-text-fill-color:' +
            color +
            '!important}' +
            target +
            '::before,' +
            target +
            '::after{content:none!important}',
        });
        try {
          refs.push(await snap());
        } finally {
          await style.evaluate((s) => s.remove());
        }
      }
      const cut = rect.x - x + rect.width * fraction;
      const result = await page.evaluate(
        async ({ images, cut, fraction }) => {
          const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
          const decoded = [];
          for (const data of images) {
            const blob = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
              type: 'image/png',
            });
            const bmp = await createImageBitmap(blob);
            ctx.canvas.width = bmp.width;
            ctx.canvas.height = bmp.height;
            ctx.drawImage(bmp, 0, 0);
            bmp.close();
            decoded.push(ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data);
          }
          const [observed, sung, waiting] = decoded;
          let wrong = 0,
            tested = 0,
            lowWrong = 0,
            lastInkRow = 0;
          const width = ctx.canvas.width;
          for (let i = 0; i < sung.length; i += 4) {
            if (Math.abs(sung[i + 2] - waiting[i + 2]) > 30) lastInkRow = Math.floor(i / 4 / width);
          }
          for (let i = 0; i < observed.length; i += 4) {
            const x = ((i / 4) % width) + 0.5,
              y = Math.floor(i / 4 / width);
            if (fraction > 0 && fraction < 1 && Math.abs(x - cut) < 1.5) continue;
            const ref = fraction === 1 || (fraction > 0 && x < cut) ? sung : waiting;
            // Inspect even the anti-aliased edge of the glyph, allowing only
            // minor differences in the browser's coverage rounding.
            const diff = Math.max(...[0, 1, 2].map((c) => Math.abs(observed[i + c] - ref[i + c])));
            if (Math.abs(sung[i + 2] - waiting[i + 2]) > 5) tested++;
            if (diff > 6) {
              wrong++;
              if (y >= lastInkRow - 6) lowWrong++;
            }
          }
          return { wrong, tested, lowWrong };
        },
        { images: [actual, ...refs], cut, fraction }
      );
      assert.ok(result.tested > 40, 'Solid reference contains visible ink');
      assert.equal(
        result.wrong,
        0,
        'Glyph ' +
          i +
          '-' +
          j +
          ' at ' +
          fraction +
          ' sweep, ' +
          result.lowWrong +
          ' wrong pixels in the lowest seven ink rows'
      );
    }
  }
}
