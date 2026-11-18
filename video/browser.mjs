import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function launch() {
  return chromium.launch({
    executablePath: process.env.KARAOKE_CHROME || undefined,
    args: [
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-lcd-text',
      '--hide-scrollbars',
    ],
  });
}
export async function stage(browser, player, { fixedClock = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.resolve(player)).href);
  await page.waitForFunction(
    () => document.querySelector('audio').controls && document.querySelector('audio').readyState >= 2
  );
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '.controls{display:none!important}' });
  if (fixedClock)
    await page.evaluate(() => {
      const audio = document.querySelector('audio');
      let time = 0,
        previous;
      Object.defineProperty(audio, 'currentTime', { get: () => time });
      window.needsImage = (seconds) => {
        time = seconds;
        audio.dispatchEvent(new Event('timeupdate'));
        const el = (id) => document.getElementById(id);
        if (!el('ending').hidden) return true;
        const state = !el('intro').hidden ? 'intro' : !el('rest').hidden ? 'rest' : el('lanes').innerHTML;
        const changed = state !== previous;
        previous = state;
        return changed;
      };
    });
  return page;
}
