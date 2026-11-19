import assert from 'node:assert/strict';
import { launch } from '../video/browser.mjs';

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto(new URL('../index.html', import.meta.url).href);
  const video = page.locator('main p:has(a:text-is("Agent skill")) + video');
  await video.evaluate((element) => element.play());
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.25);
  assert.deepEqual(await video.evaluate(v => [v.videoWidth, v.videoHeight, v.controls]), [1920, 1080, true]);
  assert.equal(await page.getByText('Watch video', {exact: true}).count(), 0);
  console.log('GitHub Pages source plays the current demo inline beneath Agent skill.');
} finally {
  await browser.close();
}
