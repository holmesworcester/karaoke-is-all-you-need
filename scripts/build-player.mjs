import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from '../src/compile.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const [manifest, output, overrideLyrics] = process.argv.slice(2);
if (!manifest || !output)
  throw Error('Usage: node scripts/build-player.mjs SONG.json PLAYER.html [EDITION.lrc]');
const song = JSON.parse(await fs.readFile(manifest, 'utf8'));
const local = (name) => path.resolve(path.dirname(manifest), name);
if (typeof song.title !== 'string' || !song.title.trim()) throw Error('A song title is required');
if (song.bpm !== undefined && !(Number.isFinite(song.bpm) && song.bpm > 0)) throw Error('Invalid bpm');
const read = (name) => fs.readFile(path.join(root, name), 'utf8');
const json = (val) => JSON.stringify(val).replaceAll('<', '\\u003c');
const escape = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
async function getEdition() {
  if (overrideLyrics || song.lyrics) return fs.readFile(overrideLyrics || local(song.lyrics), 'utf8');
  if (!Number.isSafeInteger(song.lrclibId)) throw Error('Supply a lyrics path or an LRCLIB record ID');
  const response = await fetch('https://lrclib.net/api/get/' + song.lrclibId, {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error('LRCLIB returned HTTP ' + response.status);
  return (await response.json()).syncedLyrics;
}
const lrc = await getEdition();
if (typeof lrc !== 'string') throw Error('Edition has no synchronized lyrics');
const words = lrc
  .trimEnd()
  .split(/\r?\n/)
  .filter((line) => /^\[\d+:/.test(line))
  .map((line) => {
    const text = line.replace(/^\[\d+:\d+(?:\.\d+)?\]\s*/, '').trim();
    return text ? text.split(/\s+/) : [];
  });
const hash = createHash('sha256').update(JSON.stringify(words)).digest('hex');
if (song.lyricsSha256 && song.lyricsSha256 !== hash)
  throw Error('Lyrics edition differs from the reviewed alignment');
const timing = JSON.parse(await fs.readFile(local(song.timing), 'utf8'));
const art = JSON.parse(await fs.readFile(local(song.art), 'utf8'));
let last = 0;
if (words.length !== timing.length || !words.some((r) => r.length))
  throw Error('Lyrics/timing row mismatch or empty song');
for (const [i, row] of timing.entries()) {
  if (row.length !== words[i].length) throw Error('Word count changed in row ' + i);
  for (const range of row) {
    if (!Array.isArray(range) || range.length !== 2) throw Error('Invalid word interval');
    const [a, b] = range;
    if (![a, b].every(Number.isSafeInteger) || a < last || b <= a)
      throw Error('Invalid word interval in row ' + i);
    last = b;
  }
}
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'karaoke-pack-'));
try {
  const mp3 = path.join(tmp, 'backing.mp3');
  const input = local(song.audio);
  if (path.extname(input).toLowerCase() === '.mp3') await fs.copyFile(input, mp3);
  else
    execFileSync('ffmpeg', [
      '-nostdin',
      '-v',
      'error',
      '-i',
      input,
      '-map',
      '0:a:0',
      '-map_metadata',
      '-1',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      mp3,
    ]);
  const duration = Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      mp3,
    ])
  );
  if (!(duration > last / 1000)) throw Error('Backing ends before the final word');
  const meta = {
    title: song.title,
    artist: song.artist || '',
    duration,
    bpm: song.bpm || 120,
    pickupRows: song.pickupRows || [],
  };
  compile(words, timing, art, duration, meta); // Verify CD+G tile deadlines before writing a playable file.
  const bundle = await build({
    entryPoints: [path.join(root, 'src/player.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
  });
  const licenses = (
    await Promise.all(
      ['node_modules/cdgraphics/LICENSE', 'node_modules/fflate/LICENSE', 'assets/OFL.txt'].map(read)
    )
  )
    .join('\n\n')
    .replaceAll('--', '—');
  const values = {
    TITLE: escape(song.title),
    FONT: (await fs.readFile(path.join(root, 'assets/BarlowCondensed-Bold.ttf'))).toString('base64'),
    AUDIO: (await fs.readFile(mp3)).toString('base64'),
    ART: json(art),
    SONG: json(meta),
    TIMING: json(timing),
    EDITION: json(words),
    HASH: hash,
    PLAYER: bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'),
    LICENSES: licenses,
  };
  const html = (await read('src/layout.html')).replace(/@@([A-Z]+)@@/g, (_, key) => values[key]);
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(path.resolve(output)), '.pack-'));
  try {
    await fs.writeFile(path.join(staging, 'player.html'), html);
    await fs.rename(path.join(staging, 'player.html'), output);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  console.log(output);
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
