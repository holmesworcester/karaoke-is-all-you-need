import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const d = path.resolve('demo/lights-burn-dimmer'),
  temp = path.resolve('build/fixture');
await fs.mkdir(temp, { recursive: true });
const demo = JSON.parse(await fs.readFile(path.join(d, 'song.json')));
const times = JSON.parse(await fs.readFile(path.join(d, demo.timing)));
const words = times.map((r, i) => r.map((_, j) => ['go', 'on', 'over', 'now', 'again'][(i + j) % 5]));
words[5][4] = 'sipping';
words[1][5] = 'you';
for (const i of demo.pickupRows) words[i].splice(0, 3, 'Any', 'which', 'way');
const lrc = words.map((r) => '[00:00.00] ' + r.join(' ')).join('\n');
await fs.writeFile(path.join(temp, 'words.lrc'), lrc);
const meta = {
  ...demo,
  audio: path.join(d, demo.audio),
  timing: path.join(d, demo.timing),
  art: path.join(d, demo.art),
  lyrics: 'words.lrc',
};
delete meta.lyricsSha256;
delete meta.lrclibId;
await fs.writeFile(path.join(temp, 'song.json'), JSON.stringify(meta));
execFileSync(
  process.execPath,
  ['scripts/build-player.mjs', path.join(temp, 'song.json'), 'build/fixture.html'],
  { stdio: 'inherit' }
);
