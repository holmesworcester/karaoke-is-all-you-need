import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { launch } from '../video/browser.mjs';

const dir = path.resolve('build/comparison-test');
await mkdir(dir, { recursive: true });
for (const [name, left, right] of [['karaoke', 440, 550], ['original', 880, 1200]]) {
  const tones = `aevalsrc=0.2*sin(2*PI*${left}*t)|0.2*sin(2*PI*${right}*t):s=44100:d=14`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', tones, path.join(dir, name + '.wav')]);
}
const song = {
  title: 'Stereo check',
  audio: 'karaoke.wav',
  originalAudio: 'original.wav',
  timing: 'timing.json',
  lyrics: 'words.lrc',
  art: path.resolve('demo/lights-burn-dimmer/assets.json'),
};
await writeFile(path.join(dir, 'song.json'), JSON.stringify(song));
await writeFile(path.join(dir, 'timing.json'), JSON.stringify([[[3000, 3600], [3700, 4500]]]));
await writeFile(path.join(dir, 'words.lrc'), '[00:03.00] Sing along');
const player = path.join(dir, 'player.html');
execFileSync(process.execPath, ['scripts/build-player.mjs', path.join(dir, 'song.json'), player]);

const browser = await launch();
try {
  const page = await browser.newPage();
  // Tap the actual stereo output of each mix, after its gain and before the device.
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    const outputs = [];
    AudioNode.prototype.connect = function (target, ...args) {
      if (target instanceof AudioDestinationNode) {
        const split = this.context.createChannelSplitter(2);
        connect.call(this, split);
        outputs.push([0, 1].map((channel) => {
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 2048;
          split.connect(analyser, channel);
          return analyser;
        }));
      }
      return connect.call(this, target, ...args);
    };
    window.tone = (mix, channel) => {
      const analyser = outputs[mix][channel];
      const spectrum = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(spectrum);
      const dB = Math.max(...spectrum);
      return { dB, hz: spectrum.indexOf(dB) * analyser.context.sampleRate / analyser.fftSize };
    };
  });
  await page.goto(pathToFileURL(player).href);
  const audio = page.locator('audio');
  const button = page.getByRole('switch', { name: 'Original audio' });
  await page.waitForFunction(() => document.querySelector('audio').controls);
  await button.click();
  await button.click();
  await audio.evaluate((element) => element.play());
  for (const [mix, frequencies] of [[0, [440, 550]], [1, [880, 1200]], [0, [440, 550]]]) {
    if ((await button.getAttribute('aria-checked')) !== String(Boolean(mix))) await button.click();
    await page.waitForFunction(([mix, frequencies]) => frequencies.every((expected, channel) => {
      const active = window.tone(mix, channel);
      return Math.abs(active.hz - expected) < 30 && active.dB > -45 && window.tone(1 - mix, channel).dB < -48;
    }), [mix, frequencies]);
  }
  await audio.evaluate((element) => {
    element.pause();
    element.playbackRate = 1.5;
    element.currentTime = 3.2;
  });
  const word = page.locator('.word[data-fill="sweep"]');
  await word.waitFor();
  const sweep = await word.getAttribute('style');
  assert.equal(await word.textContent(), 'Sing');
  await button.click({ clickCount: 3 });
  assert.equal(await button.getAttribute('aria-checked'), 'true');
  assert.equal(await word.getAttribute('style'), sweep);
  assert.deepEqual(await audio.evaluate((el) => [el.paused, el.currentTime, el.playbackRate]), [true, 3.2, 1.5]);
  console.log('Both stereo mixes decoded offline. Rapid switching retained the paused word, sweep, position and rate.');
} finally {
  await browser.close();
}
