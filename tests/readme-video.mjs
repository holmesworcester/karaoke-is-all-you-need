import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launch } from '../video/browser.mjs';

const repo = process.env.GITHUB_REPOSITORY || 'holmesworcester/karaoke-is-all-you-need';
const browser = await launch();
const page = await browser.newPage();
try {
  await page.goto('https://github.com/' + repo, { waitUntil: 'domcontentloaded' });
  const readme = page.locator('article.markdown-body');
  const skill = page.getByRole('link', { name: 'Agent skill', exact: true });
  const player = readme.locator('p').filter({ has: skill }).locator('+ * video');
  await player.waitFor({ state: 'visible' });
  assert.equal(await readme.getByRole('link', { name: /watch (or download|video)/i }).count(), 0);
  await player.evaluate(async video => {
    await video.play();
  });
  await page.waitForFunction(video => video.currentTime > 0.25, await player.elementHandle());
  const format = await player.evaluate(video => [video.controls, video.videoWidth, video.videoHeight, video.duration]);
  assert.deepEqual(format.slice(0, 3), [true, 1920, 1080]);
  assert.ok(Math.abs(format[3] - 263.88) < 0.1);
  console.log('Full-length demo plays inline below Agent skill on the public repository page.');
} catch (error) {
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/readme-video.png' });
  throw error;
} finally {
  await browser.close();
}
